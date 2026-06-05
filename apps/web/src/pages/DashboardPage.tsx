import { ArrowRight, Crown, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { fetchTasks } from "../lib/video";
import type { GenerationTask } from "../lib/video";
import { notices, recentTasks } from "../mock/data";

function Thumb({ name }: { name: string }) {
  return <span className={`thumb thumb-${name}`} />;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "排队中",
    processing: "生成中",
    succeeded: "已完成",
    failed: "已失败",
    cancelled: "已取消"
  };
  return labels[status] || status;
}

function statusType(status: string): "success" | "processing" | "waiting" | "failed" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "failed";
  if (status === "processing") return "processing";
  return "waiting";
}

export default function DashboardPage() {
  const { isAuthenticated, user } = useAuth();
  const [tasks, setTasks] = useState<GenerationTask[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    fetchTasks()
      .then((items) => {
        if (alive) setTasks(items.slice(0, 5));
      })
      .catch(() => {
        if (alive) setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [isAuthenticated]);

  const fallbackTasks = useMemo(() => recentTasks.slice(0, 5), []);

  return (
    <PageLayout>
      <section className="page-head">
        <h1>欢迎回来，{user?.nickname || user?.email || "创作者"}</h1>
        <p>今天想要创作点什么内容呢?</p>
      </section>
      <section className="feature-grid">
        <Card className="feature-card wide">
          <div>
            <h2>AI 视频生成</h2>
            <p>一键生成高质量视频</p>
            <Link className="round-arrow" to="/create"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d logo-3d" />
        </Card>
        <Card className="feature-card">
          <div>
            <h2>我的任务</h2>
            <p>查看任务进度和历史</p>
            <Link className="round-arrow" to="/tasks"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d panel-3d" />
        </Card>
        <Card className="feature-card">
          <div>
            <h2>模板中心</h2>
            <p>获取更多创意模板</p>
            <Link className="round-arrow" to="/templates"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d cube-3d" />
        </Card>
      </section>
      <section className="dashboard-grid">
        <Card className="recent-card">
          <div className="card-title-row">
            <h3>最近任务</h3>
            <Link to="/tasks">全部任务 <ArrowRight size={15} /></Link>
          </div>
          <div className="recent-list">
            {tasks.length > 0 ? tasks.map((task) => (
              <div className="recent-item" key={task.id}>
                <Thumb name="tech" />
                <div>
                  <strong>{task.modelDisplayName}</strong>
                  <span>{new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
                <StatusBadge status={statusType(task.status)}>{statusLabel(task.status)}</StatusBadge>
              </div>
            )) : fallbackTasks.map((task) => (
              <div className="recent-item" key={task.title}>
                <Thumb name={task.image} />
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.date}</span>
                </div>
                <StatusBadge status={task.status.includes("完成") ? "success" : task.status.includes("失败") ? "failed" : task.status.includes("生成") ? "processing" : "waiting"}>{task.status}</StatusBadge>
              </div>
            ))}
          </div>
          <Link className="more-link" to="/tasks">查看更多任务 <ArrowRight size={16} /></Link>
        </Card>
        <div className="side-stack">
          <Card className="notice-card">
            <div className="card-title-row">
              <h3>公告</h3>
              <a>更多 <ArrowRight size={15} /></a>
            </div>
            {notices.map(([title, date], index) => (
              <div className="notice-line" key={title}>
                <span />
                <strong>{title}</strong>
                {index === 0 ? <StatusBadge status="new">最新</StatusBadge> : null}
                <time>{date}</time>
              </div>
            ))}
          </Card>
          <Card className="data-card">
            <div className="card-title-row">
              <h3>创作数据</h3>
              <button className="mini-select" type="button">近7天</button>
            </div>
            <div className="mini-stats">
              {[
                [String(tasks.length || 12), "生成视频", "+20%"],
                ["1.2k", "消耗积分", "+15%"],
                ["8h", "节省时间", "+30%"],
                ["98%", "成功率", "+2%"]
              ].map(([value, label, change]) => (
                <div key={label}><strong>{value}</strong><span>{label}</span><small>{change}</small></div>
              ))}
            </div>
          </Card>
          <Card className="member-banner">
            <div>
              <h3>Aivio 会员特权</h3>
              <p>享受更多高级功能和专属权益</p>
              <Button icon={<Crown size={16} />} type="button">立即开通</Button>
            </div>
            <div className="crown-orb"><Play size={28} fill="white" /></div>
          </Card>
        </div>
      </section>
    </PageLayout>
  );
}
