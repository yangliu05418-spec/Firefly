import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { api, listenForSignedOut, notifySignedOut } from "./api";
import type { SessionUser } from "./types";
import { FireflyGlyph, FireflyMark } from "./components/Branding";
import { Studio } from "./features/studio/Studio";

function Landing({ enter }: { enter: () => void }) {
  return <main className="cinema-landing">
    <section className="cinema-hero" aria-labelledby="landing-quote">
      <video className="cinema-hero__film" autoPlay muted loop playsInline preload="metadata" poster="/ciridae/video-placeholder.webp?v=20260814b">
        <source src="/ciridae/hero_web.mp4?v=20260814b" type="video/mp4" />
      </video>
      <div className="cinema-hero__veil" />
      <div className="cinema-hero__brand" aria-label="Firefly">
        <FireflyGlyph />
        <span>FIREFLY</span>
      </div>
      <div className="cinema-hero__copy">
        <h1 id="landing-quote">
          <span>My fancies are fireflies, —</span>
          <span>Specks of living light</span>
          <span>twinkling in the dark.</span>
        </h1>
        <p>— Rabindranath Tagore</p>
      </div>
      <button className="cinema-hero__cta" onClick={enter}>
        <span>开始创作</span><ArrowRight size={16} />
      </button>
      <div className="cinema-hero__index" aria-hidden="true"><span>01</span><i /><span>FIREFLY · SEEDANCE STUDIO</span></div>
      <div className="cinema-hero__scroll" aria-hidden="true"><i /> SCROLL TO DISCOVER</div>
    </section>

    <section className="cinema-statement">
      <div className="cinema-statement__media"><img src="/ciridae/Hero.webp?v=20260814b" alt="星空下的湖泊与群山" /></div>
      <div className="cinema-statement__shade" />
      <div className="cinema-statement__copy">
        <span>FROM THOUGHT TO FRAME</span>
        <h2>让想象，拥有时间。</h2>
        <p>从文字、图像与声音出发，在同一个安静的创作空间里完成镜头。</p>
      </div>
    </section>

    <section className="cinema-process" aria-label="Firefly 创作能力">
      <header><span>THE WORKFLOW</span><p>清晰的输入，可靠的生成，完整的留存。</p></header>
      <div className="cinema-process__grid">
        <article>
          <img src="/ciridae/numbers-bg-new.webp?v=20260814b" alt="" />
          <div><span>01 / REFERENCE</span><h3>组织灵感</h3><p>组合官方支持的文字、图像、视频与音频参考。</p></div>
        </article>
        <article>
          <img src="/ciridae/pawel-czerwinski.webp?v=20260814b" alt="" />
          <div><span>02 / CREATE</span><h3>控制镜头</h3><p>让模型、生成模式和参数始终保持一致。</p></div>
        </article>
        <article>
          <img src="/ciridae/video-placeholder.webp?v=20260814b" alt="" />
          <div><span>03 / RETURN</span><h3>守候成片</h3><p>任务在队列中继续，完成后回到你的创作历史。</p></div>
        </article>
      </div>
    </section>

    <footer className="cinema-footer">
      <img src="/ciridae/footer-img-03.webp?v=20260814b" alt="抽象的电影感光轨" />
      <div className="cinema-footer__veil" />
      <div className="cinema-footer__mark"><FireflyGlyph /><span>FIREFLY</span></div>
      <p>SEEDANCE VIDEO STUDIO</p>
    </footer>
  </main>;
}

function AccessGate({ back }: { back: () => void }) {
  const error = new URLSearchParams(location.search).get("auth_error");
  const login = () => location.assign("/api/auth/feishu/start?returnTo=%2Fstudio");
  return <main className="access-page"><div className="ambient-grid" /><div className="access-card"><button className="back-link" onClick={back}>← 返回首页</button><FireflyMark /><h1>进入创作台</h1><p>仅向 dokuai.tv 企业成员开放，<br />首次登录会自动激活你的独立创作空间。</p><button className="primary-button feishu-login" onClick={login}>使用飞书企业账号登录 <ArrowRight size={16} /></button>{error && <div className="form-error">{error}</div>}</div></main>;
}

export function App() {
  const [route, setRoute] = useState(location.pathname); const [auth, setAuth] = useState<SessionUser | null | undefined>(undefined);
  const navigate = (path: string) => { history.pushState({}, "", path); setRoute(path); };
  useEffect(() => { const pop = () => setRoute(location.pathname); addEventListener("popstate", pop); api.get<{ authenticated: boolean; user?: SessionUser }>("/api/auth/session").then((r) => setAuth(r.authenticated && r.user ? r.user : null)).catch(() => setAuth(null)); return () => removeEventListener("popstate", pop); }, []);
  useEffect(() => listenForSignedOut(() => setAuth(null)), []);
  if (route === "/") return <Landing enter={() => navigate("/studio")} />;
  if (auth === undefined) return <main className="boot"><FireflyMark /><LoaderCircle className="spin" /></main>;
  if (!auth) return <AccessGate back={() => navigate("/")} />;
  return <Studio user={auth} route={route} navigate={navigate} logout={async () => { await api.delete("/api/auth/session"); notifySignedOut(); navigate("/"); }} />;
}
