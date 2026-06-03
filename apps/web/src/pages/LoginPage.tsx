import { Apple, ChevronDown, Globe, Lock, User } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Logo from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      const state = location.state as { from?: string } | null;
      navigate(state?.from || "/", { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <Logo />
        <button className="language-btn" type="button">
          <Globe size={19} />
          简体中文
          <ChevronDown size={16} />
        </button>
      </header>
      <section className="auth-hero">
        <div className="brand-panel">
          <div className="hero-mark"><span /></div>
          <h1>Aivio</h1>
          <h2>AI驱动的视频创作平台</h2>
          <p>让想象，成为影像。</p>
        </div>
        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-tabs">
            <span className="active">登录</span>
            <Link to="/register">注册</Link>
          </div>
          <label className="input-field">
            <User size={22} />
            <input placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="input-field">
            <Lock size={22} />
            <input placeholder="输入密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="auth-message error">{error}</p> : null}
          <a className="forgot" href="#">忘记密码?</a>
          <Button className="auth-submit" disabled={loading}>{loading ? "登录中..." : "登录"}</Button>
          <div className="auth-divider"><span>或使用以下方式登录</span></div>
          <div className="social-row">
            <button className="social google" type="button">G</button>
            <button className="social" type="button"><Apple size={27} fill="currentColor" /></button>
            <button className="social ui" type="button">UI</button>
          </div>
          <p className="auth-policy">登录即表示同意 <a>《用户协议》</a> 和 <a>《隐私政策》</a></p>
        </form>
      </section>
      <footer className="auth-footer">© 2024 Aivio. All rights reserved. <span>用户协议</span><span>隐私政策</span><span>联系我们</span></footer>
    </main>
  );
}
