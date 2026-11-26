import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  FileJson,
  FolderOpen,
  Laptop,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';

type AddTab = 'local' | 'json';
type LocalImportSource = 'antigravity' | 'antigravity_ide' | 'old_tools';

export function AddAccountModal() {
  const addModalOpen = useAppStore((s) => s.addModalOpen);
  const closeAddModal = useAppStore((s) => s.closeAddModal);
  const reloadAccounts = useAppStore((s) => s.reloadAccounts);
  const pushToast = useAppStore((s) => s.pushToast);
  const clientTarget = useAppStore((s) => s.clientTarget);

  const [tab, setTab] = useState<AddTab>('local');

  // 本机导入状态
  const [localImporting, setLocalImporting] = useState<LocalImportSource | null>(null);

  // JSON 导入状态
  const [jsonText, setJsonText] = useState('');
  const [importingJson, setImportingJson] = useState(false);
  const [importingFiles, setImportingFiles] = useState(false);

  const resetModalState = useCallback(() => {
    setTab('local');
    setLocalImporting(null);
    setJsonText('');
    setImportingJson(false);
    setImportingFiles(false);
  }, []);

  const handleClose = useCallback(() => {
    resetModalState();
    closeAddModal();
  }, [closeAddModal, resetModalState]);

  useEffect(() => {
    if (!addModalOpen) {
      resetModalState();
    }
  }, [addModalOpen, resetModalState]);

  useEffect(() => {
    if (!addModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addModalOpen, handleClose]);

  if (!addModalOpen) return null;

  const handleImportLocal = async (source: LocalImportSource) => {
    if (localImporting) return;
    setLocalImporting(source);
    try {
      if (source === 'old_tools') {
        const imported = await api.importFromOldTools();
        await reloadAccounts();
        if (imported.length > 0) {
          pushToast(`已从旧版工具导入 ${imported.length} 个账号`, 'success');
          handleClose();
        } else {
          pushToast('未发现可导入的旧版工具账号数据', 'info');
        }
      } else {
        const account = await api.importFromLocal(source);
        await reloadAccounts();
        const label = source === 'antigravity_ide' ? 'Antigravity IDE' : 'Antigravity 桌面端';
        pushToast(`已从 ${label} 导入 ${account.email}`, 'success');
        handleClose();
      }
    } catch (err) {
      pushToast(`导入失败：${String(err)}`, 'error');
    } finally {
      setLocalImporting(null);
    }
  };

  const handleImportJsonText = async () => {
    const trimmed = jsonText.trim();
    if (!trimmed || importingJson) return;
    setImportingJson(true);
    try {
      const imported = await api.importFromJson(trimmed);
      await reloadAccounts();
      setJsonText('');
      pushToast(`成功导入 ${imported.length} 个账号`, 'success');
      if (imported.length > 0) {
        handleClose();
      }
    } catch (err) {
      pushToast(`JSON 导入失败：${String(err)}`, 'error');
    } finally {
      setImportingJson(false);
    }
  };

  const handleImportJsonFiles = async () => {
    if (importingFiles) return;
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return;

      setImportingFiles(true);
      const result = await api.importFromFiles(paths);
      await reloadAccounts();

      if (result.failed.length > 0) {
        pushToast(
          `导入完成：成功 ${result.imported.length} 个，失败 ${result.failed.length} 个`,
          result.imported.length > 0 ? 'info' : 'error',
        );
      } else {
        pushToast(`已从文件导入 ${result.imported.length} 个账号`, 'success');
        if (result.imported.length > 0) {
          handleClose();
        }
      }
    } catch (err) {
      pushToast(`文件导入失败：${String(err)}`, 'error');
    } finally {
      setImportingFiles(false);
    }
  };

  const tabs: { id: AddTab; label: string }[] = [
    { id: 'local', label: '本机导入' },
    { id: 'json', label: 'JSON 导入' },
  ];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="添加或导入账号"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-24px)] w-full max-w-[440px] flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141518]"
      >
        {/* 顶部标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200/75 px-4 py-3 dark:border-white/[0.08]">
          <div>
            <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
              添加或导入账号
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              从本机 Antigravity 客户端直接读取登录态，或通过 JSON 批量迁移
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="关闭弹窗"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 分段标签 */}
        <div className="shrink-0 border-b border-zinc-200/75 bg-zinc-50/70 px-4 py-2 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <div className="grid grid-cols-2 rounded-lg border border-zinc-200/80 bg-zinc-100/80 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition-all ${
                    active
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'local' && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/50 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600 dark:border-indigo-400/20 dark:bg-indigo-500/[0.07] dark:text-zinc-300">
                请先在官方 Antigravity 客户端完成账号登录，再点击下方按钮直接读取本机登录信息并同步配额，无需配置 Google OAuth，所有数据仅保存在本机。
              </div>

              <button
                type="button"
                disabled={Boolean(localImporting)}
                onClick={() => void handleImportLocal('antigravity')}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-white p-3 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50/70 disabled:opacity-55 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5E6AD2]/12 text-[#5E6AD2] dark:text-indigo-400">
                    <Laptop className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                        Antigravity 桌面端
                      </span>
                      {clientTarget === 'antigravity' && (
                        <span className="rounded bg-[#5E6AD2]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#5E6AD2] dark:text-indigo-300">
                          当前目标
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      读取桌面端当前登录的账号状态并导入
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[11.5px] font-medium text-[#5E6AD2] dark:text-indigo-400">
                  {localImporting === 'antigravity' ? '导入中…' : '导入'}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(localImporting)}
                onClick={() => void handleImportLocal('antigravity_ide')}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-white p-3 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50/70 disabled:opacity-55 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-400">
                    <Terminal className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                        Antigravity IDE
                      </span>
                      {clientTarget === 'antigravity_ide' && (
                        <span className="rounded bg-[#5E6AD2]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#5E6AD2] dark:text-indigo-300">
                          当前目标
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      读取 IDE 当前活跃会话中的账号并导入
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[11.5px] font-medium text-[#5E6AD2] dark:text-indigo-400">
                  {localImporting === 'antigravity_ide' ? '导入中…' : '导入'}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(localImporting)}
                onClick={() => void handleImportLocal('old_tools')}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-white p-3 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50/70 disabled:opacity-55 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400">
                    <Download className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                      旧版工具数据
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      扫描并批量迁移本机旧版工具历史账号
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[11.5px] font-medium text-[#5E6AD2] dark:text-indigo-400">
                  {localImporting === 'old_tools' ? '扫描中…' : '扫描导入'}
                </span>
              </button>
            </div>
          )}

          {tab === 'json' && (
            <div className="space-y-3.5">
              <div className="space-y-2 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                    <FileJson className="h-3.5 w-3.5 text-[#5E6AD2] dark:text-indigo-400" />
                    <span>JSON 批量导入</span>
                  </div>
                  <button
                    type="button"
                    disabled={importingFiles}
                    onClick={() => void handleImportJsonFiles()}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200/85 bg-white px-2 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:bg-white/[0.09]"
                  >
                    <FolderOpen className="h-3 w-3" />
                    {importingFiles ? '导入中…' : '选择 JSON 文件导入'}
                  </button>
                </div>

                <textarea
                  rows={4}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder='粘贴导出的账号 JSON 数组或单个对象，例如 [{"email":"...","refresh_token":"..."}]'
                  className="w-full resize-none rounded-lg border border-zinc-200/90 bg-white p-2.5 font-mono text-[11px] text-zinc-800 outline-none placeholder:font-sans placeholder:text-zinc-400 focus:border-[#5E6AD2] dark:border-white/[0.1] dark:bg-[#111215] dark:text-zinc-100 dark:focus:border-indigo-400"
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={importingJson || !jsonText.trim()}
                    onClick={() => void handleImportJsonText()}
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-zinc-900 px-3 text-[11.5px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-45 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <Upload className="h-3 w-3" />
                    {importingJson ? '导入中…' : '解析并导入'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
