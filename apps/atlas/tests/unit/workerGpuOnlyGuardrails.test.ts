import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

interface ParsedSource {
  readonly repoPath: string;
  readonly text: string;
  readonly sourceFile: ts.SourceFile;
}

interface LocatedCall {
  readonly container: string;
  readonly expression: string;
  readonly line: number;
  readonly node: ts.CallExpression;
}

function parseSource(repoPath: string): ParsedSource {
  const text = readFileSync(path.join(repoRoot, repoPath), 'utf8');
  return {
    repoPath,
    text,
    sourceFile: ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

function normalizeSourceText(text: string): string {
  return text.replace(/\s+/g, '');
}

function lineForNode(source: ParsedSource, node: ts.Node): number {
  return source.sourceFile.getLineAndCharacterOfPosition(node.getStart(source.sourceFile)).line + 1;
}

function containsNode(parent: ts.Node, child: ts.Node): boolean {
  return parent.pos <= child.pos && child.end <= parent.end;
}

function namedContainerFor(source: ParsedSource, node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if ((ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) && current.name) {
      return current.name.getText(source.sourceFile);
    }
    current = current.parent;
  }
  return '<top-level>';
}

function callExpressionText(source: ParsedSource, call: ts.CallExpression): string {
  return normalizeSourceText(call.expression.getText(source.sourceFile));
}

function callMatches(source: ParsedSource, call: ts.CallExpression, target: string): boolean {
  const expressionText = callExpressionText(source, call);
  const normalizedTarget = normalizeSourceText(target);
  if (expressionText === normalizedTarget) return true;
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text === target;
  }
  if (ts.isIdentifier(call.expression)) {
    return call.expression.text === target;
  }
  return false;
}

function findCalls(
  source: ParsedSource,
  predicate: (call: ts.CallExpression) => boolean,
): LocatedCall[] {
  const calls: LocatedCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && predicate(node)) {
      calls.push({
        container: namedContainerFor(source, node),
        expression: node.expression.getText(source.sourceFile),
        line: lineForNode(source, node),
        node,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  return calls;
}

function namedFunction(source: ParsedSource, name: string): ts.FunctionDeclaration | ts.MethodDeclaration {
  let match: ts.FunctionDeclaration | ts.MethodDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name?.getText(source.sourceFile) === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  expect(match, `${source.repoPath} should contain function ${name}`).not.toBeNull();
  return match as ts.FunctionDeclaration | ts.MethodDeclaration;
}

function branchContainsReturn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    return statement.statements.some(branchContainsReturn);
  }
  if (ts.isIfStatement(statement)) {
    return branchContainsReturn(statement.thenStatement) ||
      Boolean(statement.elseStatement && branchContainsReturn(statement.elseStatement));
  }
  return false;
}

function isGuardReturn(
  source: ParsedSource,
  statement: ts.Statement,
  guard: (conditionText: string) => boolean,
): boolean {
  return ts.isIfStatement(statement) &&
    guard(normalizeSourceText(statement.expression.getText(source.sourceFile))) &&
    branchContainsReturn(statement.thenStatement);
}

function hasPriorGuardReturn(
  source: ParsedSource,
  call: ts.CallExpression,
  container: ts.Node,
  guard: (conditionText: string) => boolean,
): boolean {
  let current: ts.Node = call;
  while (current !== container) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isBlock(parent)) {
      const statementIndex = parent.statements.findIndex((statement) => containsNode(statement, current));
      if (statementIndex >= 0) {
        const priorStatements = parent.statements.slice(0, statementIndex);
        if (priorStatements.some((statement) => isGuardReturn(source, statement, guard))) {
          return true;
        }
      }
    }
    current = parent;
  }
  return false;
}

function isInsideNonStrictWorkerOnlyBranch(
  source: ParsedSource,
  call: ts.CallExpression,
  container: ts.Node,
): boolean {
  let current: ts.Node = call;
  while (current !== container) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isIfStatement(parent)) {
      const conditionText = normalizeSourceText(parent.expression.getText(source.sourceFile));
      const inThen = containsNode(parent.thenStatement, current);
      const inElse = parent.elseStatement ? containsNode(parent.elseStatement, current) : false;
      if (inThen && conditionText === '!this.strictWorkerOnly') return true;
      if (inElse && conditionText === 'this.strictWorkerOnly') return true;
    }
    current = parent;
  }
  return false;
}

function callsInFunction(
  source: ParsedSource,
  functionName: string,
  targets: readonly string[],
): LocatedCall[] {
  const container = namedFunction(source, functionName);
  return findCalls(source, (call) => (
    containsNode(container, call) &&
    targets.some((target) => callMatches(source, call, target))
  ));
}

function expectGuardBeforeCalls(input: {
  readonly source: ParsedSource;
  readonly functionName: string;
  readonly targets: readonly string[];
  readonly guard: (conditionText: string) => boolean;
  readonly guardLabel: string;
}): void {
  const container = namedFunction(input.source, input.functionName);
  const calls = callsInFunction(input.source, input.functionName, input.targets);
  expect(calls.length, `${input.functionName} should still exercise ${input.targets.join(', ')}`).toBeGreaterThan(0);

  const unguarded = calls.filter((call) => (
    !hasPriorGuardReturn(input.source, call.node, container, input.guard)
  ));
  expect(
    unguarded.map((call) => `${input.source.repoPath}:${call.line} ${call.container} -> ${call.expression}`),
    `${input.functionName} must return on ${input.guardLabel} before ${input.targets.join(', ')}`,
  ).toEqual([]);
}

function methodCallTarget(source: ParsedSource, call: ts.CallExpression): {
  readonly receiver: string;
  readonly method: string;
} | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  return {
    receiver: normalizeSourceText(call.expression.expression.getText(source.sourceFile)),
    method: call.expression.name.text,
  };
}

function directThisMethodCallers(source: ParsedSource, methodName: string): string[] {
  return Array.from(new Set(findCalls(source, (call) => {
    const target = methodCallTarget(source, call);
    return target?.receiver === 'this' && target.method === methodName;
  }).map((call) => call.container))).sort();
}

function importedNamesFrom(source: ParsedSource, moduleSpecifier: string): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleSpecifier
    ) {
      const namedBindings = node.importClause?.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        names.push(...namedBindings.elements.map((element) => element.name.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  return names.sort();
}

describe('worker GPU-only guardrails', () => {
  const host = parseSource('src/services/render/workerPresentingRenderHostPort.ts');
  const runtimeHandlers = parseSource('src/services/render/workerRenderHostRuntimeHandlers.ts');
  const runtimeBridge = parseSource('src/services/render/workerRenderHostRuntimeBridge.ts');
  const runtimeWorker = parseSource('src/workers/runtimeHost.worker.ts');

  const isGpuOnlyGuard = (conditionText: string) => conditionText === 'this.isGpuOnlyPresentation';
  const shouldUseWorkerGpuPresentationGuard = (conditionText: string) => (
    conditionText === 'shouldUseWorkerGpuPresentation()'
  );
  const webGpuSurfaceGuard = (conditionText: string) => (
    conditionText === 'isWorkerGpuTargetSurface(surface)'
  );

  it('blocks worker software frame and snapshot paths before host presentation work starts', () => {
    for (const guard of [
      {
        functionName: 'presentLayers',
        targets: ['this.startSoftwarePresentation'],
      },
      {
        functionName: 'cacheLatestWorkerCompositeFrame',
        targets: ['this.buildSoftwareFrameForPresentation', 'bridge.presentSoftwareFrame'],
      },
      {
        functionName: 'presentCachedCompositeFrame',
        targets: ['this.compositeCache.createFrame', 'bridge.presentSoftwareFrame'],
      },
      {
        functionName: 'captureVideoFrameAtTime',
        targets: ['cacheWorkerSoftwareHtmlVideoSnapshot', 'this.fallback.captureVideoFrameAtTime'],
      },
      {
        functionName: 'preCacheVideoFrame',
        targets: ['cacheWorkerSoftwareHtmlVideoSnapshot', 'this.fallback.preCacheVideoFrame'],
      },
      {
        functionName: 'ensureVideoFrameCached',
        targets: ['cacheWorkerSoftwareHtmlVideoSnapshot', 'this.fallback.ensureVideoFrameCached'],
      },
      {
        functionName: 'cacheFrameAtTime',
        targets: ['cacheWorkerSoftwareHtmlVideoSnapshot', 'this.fallback.cacheFrameAtTime'],
      },
    ]) {
      expectGuardBeforeCalls({
        source: host,
        functionName: guard.functionName,
        targets: guard.targets,
        guard: isGpuOnlyGuard,
        guardLabel: 'this.isGpuOnlyPresentation',
      });
    }
  });

  it('keeps software preview building behind the GPU-only guarded host chain', () => {
    expect(callsInFunction(host, 'buildSoftwareFrameForPresentation', [
      'buildWorkerSoftwarePreviewFrame',
    ]).map((call) => call.container)).toEqual(['buildSoftwareFrameForPresentation']);

    expect(directThisMethodCallers(host, 'buildSoftwareFrameForPresentation')).toEqual([
      'cacheLatestWorkerCompositeFrame',
      'runSoftwarePresentation',
    ]);
    expect(directThisMethodCallers(host, 'runSoftwarePresentation')).toEqual([
      'startSoftwarePresentation',
    ]);
    expect(directThisMethodCallers(host, 'startSoftwarePresentation')).toEqual([
      'presentLayers',
      'startSoftwarePresentation',
    ]);
  });

  it('keeps main fallback preview methods unreachable while strict worker-only is active', () => {
    const guardedFallbackMethods = new Set([
      'render',
      'renderToPreviewCanvas',
      'requestRender',
      'requestNewFrameRender',
      'captureVideoFrameAtTime',
      'preCacheVideoFrame',
      'ensureVideoFrameCached',
      'cacheFrameAtTime',
    ]);
    const calls = findCalls(host, (call) => {
      const target = methodCallTarget(host, call);
      return target?.receiver === 'this.fallback' && guardedFallbackMethods.has(target.method);
    });

    expect(calls.length).toBeGreaterThan(0);
    const unguarded = calls.filter((call) => {
      const container = namedFunction(host, call.container);
      return !isInsideNonStrictWorkerOnlyBranch(host, call.node, container) &&
        !hasPriorGuardReturn(host, call.node, container, (conditionText) => (
          conditionText === 'this.strictWorkerOnly' || conditionText === 'this.isGpuOnlyPresentation'
        ));
    });

    expect(
      unguarded.map((call) => `${host.repoPath}:${call.line} ${call.container} -> ${call.expression}`),
      'main fallback preview calls must stay behind strictWorkerOnly guards',
    ).toEqual([]);
  });

  it('rejects presentSoftwareFrame before runtime worker WebGPU presentation can paint software', () => {
    expectGuardBeforeCalls({
      source: runtimeHandlers,
      functionName: 'acceptCommand',
      targets: ['paintSoftwareFrame'],
      guard: shouldUseWorkerGpuPresentationGuard,
      guardLabel: 'shouldUseWorkerGpuPresentation()',
    });

    expectGuardBeforeCalls({
      source: runtimeHandlers,
      functionName: 'paintSoftwareFrame',
      targets: ['forEachWorkerSoftwareLayerInPaintOrder', 'drawWorkerSoftwareLayer'],
      guard: webGpuSurfaceGuard,
      guardLabel: "surface.kind === 'webgpu'",
    });
  });

  it('does not wire the software-frame GPU presenter into worker-webgpu-present runtime paths', () => {
    const runtimeSources = [
      runtimeHandlers,
      runtimeBridge,
      runtimeWorker,
      host,
    ];
    const calls = runtimeSources.flatMap((source) => findCalls(
      source,
      (call) => callMatches(source, call, 'paintWorkerGpuSoftwareFrame'),
    ).map((call) => `${source.repoPath}:${call.line} ${call.container} -> ${call.expression}`));

    expect(importedNamesFrom(runtimeHandlers, './workerRenderHostGpuPresenter')).not.toContain(
      'paintWorkerGpuSoftwareFrame',
    );
    expect(calls).toEqual([]);
  });
});
