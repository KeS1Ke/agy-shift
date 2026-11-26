import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { useAppStore } from '../stores/useAppStore';
import * as api from '../services/tauri';

const RELEASE_PAGE = 'https://github.com/KeS1Ke/agy-shift/releases/latest';

export function UpdateDialog() {
  const close = useAppStore((s) => s.closeUpdateModal);
  const dialog = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState('');
  const [operation, setOperation] = useState<'check' | 'install' | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let disposed = false;
    void getVersion().then((value) => {
      if (!disposed) setVersion(value);
    }).catch(() => {});
    return () => {
      disposed = true;
      element?.close();
    };
  }, []);

  useEffect(() => () => {
    if (update) void update.close().catch(() => {});
  }, [update]);

  const checkForUpdate = async () => {
    setOperation('check');
    setStatus('');
    setUpdate(null);
    try {
      const next = await check({ timeout: 15_000 });
      setUpdate(next);
      setStatus(next ? '发现新版本 v' + next.version : '当前已是最新版本');
      void api.updateLastCheckTime().catch(() => {});
    } catch (error) {
      setStatus('检查更新失败：' + String(error));
    } finally {
      setOperation(null);
    }
  };

  const install = async () => {
    if (!update) return;
    setOperation('install');
    setStatus('正在下载并验证更新…');
    try {
      await update.downloadAndInstall();
      await api.relaunchAfterUpdate();
    } catch (error) {
      setStatus('更新失败：' + String(error));
    } finally {
      setOperation(null);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="update-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!operation) close();
      }}
      className="w-[min(356px,calc(100%-32px))] rounded-xl border border-stone-200 bg-[#fffdf9] p-5 text-stone-900 shadow-xl backdrop:bg-black/50 dark:border-[#48414b] dark:bg-[#231f26] dark:text-stone-100"
    >
      <h2 id="update-title" className="text-base font-semibold">应用内更新</h2>
      {version && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">当前版本 v{version}</p>}
      {status && <p aria-live="polite" className="mt-3 max-h-24 overflow-y-auto break-words text-xs">{status}</p>}
      {update?.body && (
        <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300">
          {update.body}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void openUrl(RELEASE_PAGE).catch((error) => setStatus('打开 GitHub 发布页失败：' + String(error)))}
          className="mr-auto rounded-md px-2 py-1.5 text-xs underline underline-offset-2 hover:bg-slate-100 dark:hover:bg-white/10"
        >
          GitHub 发布页
        </button>
        <button type="button" onClick={close} disabled={Boolean(operation)} className="rounded-md px-3 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/10">
          关闭
        </button>
        <button
          type="button"
          onClick={() => void (update ? install() : checkForUpdate())}
          disabled={Boolean(operation)}
          className="rounded-md bg-[#9b3c2a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#863123] disabled:opacity-50"
        >
          {operation === 'check' ? '检查中…' : operation === 'install' ? '安装中…' : update ? '下载并安装' : '检查更新'}
        </button>
      </div>
    </dialog>
  );
}
