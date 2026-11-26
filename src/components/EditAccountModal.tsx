import { useCallback, useEffect, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';

export function EditAccountModal() {
  const editingAccount = useAppStore((s) => s.editingAccount);
  const setEditingAccount = useAppStore((s) => s.setEditingAccount);
  const reloadAccounts = useAppStore((s) => s.reloadAccounts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingAccount) return;
    setNote(editingAccount.notes ?? '');
    const initialTags = Array.from(
      new Set((editingAccount.tags ?? []).map((t) => t.trim()).filter(Boolean)),
    );
    setTags(initialTags);
    setTagInput('');
    setSaving(false);
  }, [editingAccount]);

  const handleClose = useCallback(() => {
    if (saving) return;
    setEditingAccount(null);
  }, [saving, setEditingAccount]);

  useEffect(() => {
    if (!editingAccount) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingAccount, handleClose]);

  if (!editingAccount) return null;

  const mergePendingTags = (baseTags: string[], raw: string): string[] => {
    const parts = raw
      .split(/[,，]/)
      .map((item) => item.trim().replace(/^#+/, ''))
      .filter(Boolean);
    if (parts.length === 0) return baseTags;
    const next = [...baseTags];
    for (const item of parts) {
      if (!next.includes(item)) {
        next.push(item);
      }
    }
    return next;
  };

  const commitTagInput = (rawValue?: string) => {
    const source = rawValue ?? tagInput;
    const next = mergePendingTags(tags, source);
    if (next.length !== tags.length) {
      setTags(next);
    }
    setTagInput('');
  };

  const handleRemoveTag = (target: string) => {
    setTags((prev) => prev.filter((t) => t !== target));
  };

  const handleTagInputChange = (value: string) => {
    if (value.includes(',') || value.includes('，')) {
      commitTagInput(value);
      return;
    }
    setTagInput(value);
  };

  const handleSave = async () => {
    if (saving) return;
    const finalTags = mergePendingTags(tags, tagInput);
    setSaving(true);
    try {
      await api.updateAccountNote(editingAccount.id, note.trim());
      await api.updateAccountTags(editingAccount.id, finalTags);
      await reloadAccounts();
      pushToast(`已保存 ${editingAccount.email} 的备注与标签`, 'success');
      setEditingAccount(null);
    } catch (err) {
      pushToast(`保存失败：${String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px]"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="编辑备注与标签"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-24px)] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141518]"
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200/75 px-4 py-3 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
              备注与标签
            </h2>
            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {editingAccount.email}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            aria-label="关闭弹窗"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <label
              htmlFor="account-note-input"
              className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-300"
            >
              账号备注
            </label>
            <textarea
              id="account-note-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：主力工作号、高配额备用号、特定项目专用..."
              className="w-full resize-none rounded-lg border border-zinc-200/90 bg-zinc-50/50 p-2.5 text-[12px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#5E6AD2] focus:bg-white dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-zinc-100 dark:focus:border-indigo-400 dark:focus:bg-[#111215]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="account-tag-input"
                className="flex items-center gap-1 text-[12px] font-medium text-zinc-700 dark:text-zinc-300"
              >
                <Tag className="h-3.5 w-3.5 text-[#5E6AD2] dark:text-indigo-400" />
                标签
              </label>
              <span className="text-[10.5px] text-zinc-400">按回车或逗号添加，自动去重</span>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-white/[0.08] dark:bg-white/[0.07] dark:text-zinc-200"
                  >
                    <span>#{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`移除标签 ${tag}`}
                      className="rounded-full text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <input
                id="account-tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => handleTagInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTagInput();
                  } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                    setTags((prev) => prev.slice(0, -1));
                  }
                }}
                placeholder="输入标签名后按 Enter"
                className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200/90 bg-white px-2.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-[#5E6AD2] dark:border-white/[0.1] dark:bg-[#111215] dark:text-zinc-100 dark:focus:border-indigo-400"
              />
              <button
                type="button"
                disabled={!tagInput.trim()}
                onClick={() => commitTagInput()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-zinc-200/85 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-45 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:bg-white/[0.09]"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200/75 bg-zinc-50/70 px-4 py-2.5 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <button
            type="button"
            disabled={saving}
            onClick={handleClose}
            className="h-8 rounded-lg border border-zinc-200/85 bg-white px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:bg-white/[0.09]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="h-8 rounded-lg bg-[#5E6AD2] px-3.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-[#4F5BC4] disabled:opacity-55"
          >
            {saving ? '保存中…' : '保存更改'}
          </button>
        </div>
      </div>
    </div>
  );
}
