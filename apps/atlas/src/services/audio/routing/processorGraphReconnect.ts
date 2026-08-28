import type { AudioRouteProcessorNode } from './routeGraphTypes';

export function reconnectCustomProcessorInternal(node: AudioRouteProcessorNode): void {
  if (
    node.type === 'delay' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.delay &&
    node.feedbackGain &&
    node.toneFilter &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.delay);
    node.delay.connect(node.toneFilter);
    node.toneFilter.connect(node.feedbackGain);
    node.feedbackGain.connect(node.delay);
    node.toneFilter.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'reverb' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.convolver &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.convolver);
    node.convolver.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'saturation' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.waveShaper &&
    node.toneFilter &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.waveShaper);
    node.waveShaper.connect(node.toneFilter);
    node.toneFilter.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'hum-notch' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.wetGain &&
    node.filters?.length
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    let wetTail: AudioNode = node.inputNode;
    for (const filter of node.filters) {
      wetTail.connect(filter);
      wetTail = filter;
    }
    wetTail.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'de-esser' &&
    node.inputNode &&
    node.outputNode &&
    node.lowBandFilter &&
    node.highBandFilter &&
    node.compressor &&
    node.makeupGain
  ) {
    node.inputNode.connect(node.lowBandFilter);
    node.inputNode.connect(node.highBandFilter);
    node.lowBandFilter.connect(node.outputNode);
    node.highBandFilter.connect(node.compressor);
    node.compressor.connect(node.makeupGain);
    node.makeupGain.connect(node.outputNode);
  }
}
