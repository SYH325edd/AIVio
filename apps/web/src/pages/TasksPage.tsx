import { Download, ExternalLink, FileText, Image as ImageIcon, PlayCircle, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import PromptViewerModal from "../components/PromptViewerModal";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { fetchTask, fetchTasks, normalizeResult, summarizeResultRaw } from "../lib/video";
import type { GenerationTask } from "../lib/video";

const tabs = [
  { key: "all", label: "全部" },
  { key: "processing", label: "生成中" },
  { key: "succeeded", label: "已完成" },
  { key: "failed", label: "已失败" }
];

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
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "processing") return "processing";
  return "waiting";
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function shortId(id: string) {
  return id.slice(0, 12);
}

function taskResolution(task?: GenerationTask | null) {
  return String(task?.pricingBreakdown?.resolution || task?.params?.resolution || "--");
}

function taskDuration(task?: GenerationTask | null) {
  const value = task?.pricingBreakdown?.outputDuration || task?.params?.outputDuration || task?.params?.duration;
  return value ? `${value}s` : "--";
}

function taskRatio(task?: GenerationTask | null) {
  return String(task?.params?.ratio || task?.pricingBreakdown?.ratio || "16:9");
}

function ratioClass(task?: GenerationTask | null) {
  const ratio = taskRatio(task);
  if (ratio.includes("9:16")) return "ratio-portrait";
  if (ratio.includes("1:1")) return "ratio-square";
  return "ratio-landscape";
}

function taskError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录。";
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "任务列表加载失败，请稍后重试。";
}

function missingResultMessage(task?: GenerationTask | null) {
  const summary = summarizeResultRaw(task);
  return summary ? `任务已完成，但未返回结果地址。原始返回摘要：${summary}` : "任务已完成，但未返回结果地址。";
}

export default function TasksPage() {
  const navigate = useNavigate();
  const { refreshBalance, refreshCreditLogs } = useAuth();
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [promptModalTask, setPromptModalTask] = useState<GenerationTask | null>(null);

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const items = await fetchTasks();
      setTasks(items);
      const latestSuccess = items.find((task) => task.status === "succeeded" && normalizeResult(task));
      setSelectedTaskId((current) => current || latestSuccess?.id || items[0]?.id || "");
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        navigate("/login");
        return;
      }
      setError(taskError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const tabMatch =
        activeTab === "all" ||
        (activeTab === "processing" && ["pending", "processing"].includes(task.status)) ||
        task.status === activeTab;
      const keywordMatch = `${task.id} ${task.providerTaskId} ${task.modelDisplayName} ${task.prompt}`.toLowerCase().includes(keyword.toLowerCase());
      return tabMatch && keywordMatch;
    });
  }, [activeTab, keyword, tasks]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) || filteredTasks[0] || null, [filteredTasks, selectedTaskId, tasks]);
  const selectedResult = useMemo(() => normalizeResult(selectedTask), [selectedTask]);

  async function refreshSingleTask(taskId: string) {
    setError("");
    try {
      const task = await fetchTask(taskId);
      setTasks((current) => current.map((item) => (item.id === task.id ? task : item)));
      setSelectedTaskId(task.id);
      if (task.status === "failed") {
        await Promise.all([refreshBalance(), refreshCreditLogs()]);
      }
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 401) {
        navigate("/login");
        return;
      }
      setError(taskError(refreshError));
    }
  }

  function selectTask(task: GenerationTask) {
    setSelectedTaskId(task.id);
  }

  return (
    <PageLayout>
      <section className="tasks-head tasks-head-polished">
        <div>
          <h1>我的任务</h1>
          <p>管理生成记录，预览、回看并保存结果。</p>
        </div>
        <div className="tasks-controls">
          <label className="search-box tasks-search">
            <Search size={18} />
            <input placeholder="搜索任务 ID、模型或 Prompt" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </label>
          <button className="sort-btn tasks-refresh" type="button" onClick={loadTasks}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
      </section>

      <div className="tabs-row tasks-tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab.key ? "active" : ""} type="button" key={tab.key} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {selectedTask ? (
        <Card className="task-result-preview task-preview-card">
          <div className="card-title-row compact-row task-preview-header">
            <div>
              <h3>结果预览</h3>
              <p className="panel-subtitle">{selectedTask.modelDisplayName}</p>
            </div>
            {selectedResult ? (
              <div className="admin-inline-actions">
                <a className="task-link" href={selectedResult.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> 查看
                </a>
                <a className="task-link" href={selectedResult.url} download target="_blank" rel="noreferrer">
                  <Download size={14} /> 下载
                </a>
              </div>
            ) : null}
          </div>

          <div className="task-preview-body">
            <div className="task-result-stage task-result-stage-compact">
              {selectedResult?.kind === "video" ? (
                <video className={`task-preview-media ${ratioClass(selectedTask)}`} controls playsInline src={selectedResult.url} />
              ) : null}
              {selectedResult?.kind === "image" ? (
                <img className={`task-preview-media ${ratioClass(selectedTask)}`} alt="生成结果" src={selectedResult.url} />
              ) : null}
              {!selectedResult ? (
                <div className={`task-preview-empty ${selectedTask.status === "failed" || selectedTask.status === "cancelled" ? "failed" : ""}`}>
                  <strong>{statusLabel(selectedTask.status)}</strong>
                  <span>{selectedTask.status === "succeeded" ? missingResultMessage(selectedTask) : selectedTask.errorMessage || "暂无可预览结果"}</span>
                </div>
              ) : null}
            </div>

            <aside className="task-selected-meta">
              <div><span>模型</span><strong>{selectedTask.modelDisplayName}</strong></div>
              <div><span>状态</span><StatusBadge status={statusType(selectedTask.status)}>{statusLabel(selectedTask.status)}</StatusBadge></div>
              <div><span>分辨率</span><strong>{taskResolution(selectedTask)}</strong></div>
              <div><span>时长</span><strong>{taskDuration(selectedTask)}</strong></div>
              <div><span>消耗</span><strong>{selectedTask.cost} 积分</strong></div>
              <div><span>创建时间</span><strong>{formatTime(selectedTask.createdAt)}</strong></div>
            </aside>
          </div>
        </Card>
      ) : null}

      <Card className="task-table-card task-list-card">
        <div className="task-list-head">
          <div>
            <h3>任务列表</h3>
            <p>共 {filteredTasks.length} 条记录</p>
          </div>
        </div>
        {error ? <p className="data-error">{error}</p> : null}
        <div className="task-card-table">
          {filteredTasks.map((task) => {
            const result = normalizeResult(task);
            return (
              <article className={`task-row-card${selectedTask?.id === task.id ? " active" : ""}`} key={task.id} onClick={() => selectTask(task)}>
                <div className={`task-row-thumb ${result?.kind || "empty"}`}>
                  {result?.kind === "image" ? <img alt="" src={result.url} /> : null}
                  {result?.kind === "video" ? <video muted playsInline src={result.url} /> : null}
                  {!result ? task.status === "succeeded" ? <PlayCircle size={22} /> : <ImageIcon size={22} /> : null}
                </div>
                <div className="task-row-main">
                  <div className="task-row-title">
                    <strong title={task.id}>{shortId(task.id)}</strong>
                    <StatusBadge status={statusType(task.status)}>{statusLabel(task.status)}</StatusBadge>
                  </div>
                  <span className="task-row-model" title={task.modelDisplayName}>{task.modelDisplayName}</span>
                  <p title={task.prompt}>{task.prompt || "未填写 Prompt"}</p>
                </div>
                <div className="task-row-cost">
                  <span>消耗</span>
                  <strong>{task.cost} 积分</strong>
                </div>
                <div className="task-row-params">
                  <span>{taskResolution(task)}</span>
                  <span>{taskDuration(task)}</span>
                </div>
                <div className="task-row-actions" onClick={(event) => event.stopPropagation()}>
                  <button className="mini-action" type="button" onClick={() => refreshSingleTask(task.id)}>查看</button>
                  <button className="mini-action" type="button" onClick={() => setPromptModalTask(task)}><FileText size={13} /> 查看提示词</button>
                  {result ? (
                    <a className="mini-action" href={result.url} download target="_blank" rel="noreferrer">
                      <Download size={13} /> 下载
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {!loading && filteredTasks.length === 0 ? <div className="empty-state">暂无任务</div> : null}
        {loading ? <div className="empty-state">任务加载中...</div> : null}
      </Card>
      {promptModalTask ? (
        <PromptViewerModal
          title="完整提示词"
          prompt={promptModalTask.prompt}
          onClose={() => setPromptModalTask(null)}
        />
      ) : null}
    </PageLayout>
  );
}
