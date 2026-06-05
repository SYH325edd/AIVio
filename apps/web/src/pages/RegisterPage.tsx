import { Apple, ChevronDown, Globe, Lock, Mail, User } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Logo from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await register(email, password, nickname);
      setSuccess("注册成功，请登录");
      setTimeout(() => navigate("/login"), 700);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "注册失败，请稍后重试。");
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
        <form className="auth-card register-card" onSubmit={handleSubmit}>
          <div className="auth-tabs">
            <Link to="/login">登录</Link>
            <span className="active">注册</span>
          </div>
          <label className="input-field"><Mail size={22} /><input placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="input-field"><User size={22} /><input placeholder="昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} /></label>
          <label className="input-field"><Lock size={22} /><input placeholder="设置密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error ? <p className="auth-message error">{error}</p> : null}
          {success ? <p className="auth-message success">{success}</p> : null}
          <Button className="auth-submit" disabled={loading}>{loading ? "注册中..." : "注册"}</Button>
          <div className="auth-divider"><span>或使用以下方式注册</span></div>
          <div className="social-row">
            <button className="social google" type="button">G</button>
            <button className="social" type="button"><Apple size={27} fill="currentColor" /></button>
            <button className="social ui" type="button">UI</button>
          </div>
          <p className="auth-policy">注册即表示同意 <a>《用户协议》</a> 和 <a>《隐私政策》</a></p>
        </form>
      </section>
      <footer className="auth-footer">© 2024 Aivio. All rights reserved. <span>用户协议</span><span>隐私政策</span><span>联系我们</span></footer>
    </main>
  );
}
