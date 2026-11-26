import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAppStore } from '../stores/useAppStore';
import { checkAppUpdate, installAppUpdate } from '../services/updater';

const RELEASE_PAGE = 'https://github.com/KeS1Ke/agy-shift/releases/latest';

export function UpdateDialog() {
  const close = useAppStore((s) => s.closeUpdateModal);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const availableVersion = useAppStore((s) => s.availableUpdateVersion);
  const availableBody = useAppStore((s) => s.availableUpdateBody);
  const updateProgress = useAppStore((s) => s.updateProgress);
  const statusMessage = useAppStore((s) => s.updateStatusMessage);
  const dialog = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState('');
  const [localError, setLocalError] = useState('');

  const busy =
    updateStatus === 'checking' ||
    updateStatus === 'downloading' ||
    updateStatus === 'installing';

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let disposed = false;
    void getVersion()
      .then((value) => {
        if (!disposed) setVersion(value);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      element?.close();
    };
  }, []);

  const handlePrimaryAction = async () => {
    setLocalError('');
    if (availableVersion && (updateStatus === 'available' || updateStatus === 'ready')) {
      await installAppUpdate();
    } else {
      await checkAppUpdate({ silent: false, autoDownload: false });
    }
  };

  const primaryLabel =
    updateStatus === 'checking'
      ? '检查中…'
      : updateStatus === 'downloading'
        ? updateProgress !== null
          ? `下载中 ${updateProgress}%`
          : '下载中…'
        : updateStatus === 'installing'
          ? '安装中…'
          : updateStatus === 'ready'
            ? '立即安装'
            : availableVersion
              ? '下载并安装'
              : '检查更新';

  const displayStatus = localError || statusMessage;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="update-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      className="w-[min(420px,calc(100%-32px))] rounded-xl border border-stone-200 bg-[#fffdf9] p-6 text-stone-900 shadow-xl backdrop:bg-black/50 dark:border-[#48414b] dark:bg-[#231f26] dark:text-stone-100"
    >
      <h2 id="update-title" className="text-lg font-semibold leading-snug">
        应用内更新
      </h2>
      {version && (
        <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-300">
          当前版本 v{version}
        </p>
      )}
      {displayStatus && (
        <p
          aria-live="polite"
          className="mt-3.5 max-h-28 overflow-y-auto break-words text-sm leading-relaxed text-stone-800 dark:text-stone-100"
        >
          {displayStatus}
        </p>
      )}
      {updateStatus === 'downloading' && updateProgress !== null && (
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-cyan-500 transition-all"
            style={{ width: `${updateProgress}%` }}
          />
        </div>
      )}
      {availableBody && (
        <p className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-stone-100/80 p-3 text-[13.5px] leading-relaxed text-stone-700 dark:bg-white/[0.05] dark:text-stone-200">
          {availableBody}
        </p>
      )}
      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={() =>
            void openUrl(RELEASE_PAGE).catch((error) =>
              setLocalError(`打开 GitHub 发布页失败：${String(error)}`),
            )
          }
          className="mr-auto rounded-md px-2.5 py-2 text-[13.5px] font-medium underline underline-offset-4 hover:bg-stone-100 dark:hover:bg-white/10"
        >
          GitHub 发布页
        </button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="rounded-md px-3.5 py-2 text-[13.5px] font-medium hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-white/10"
        >
          关闭
        </button>
        <button
          type="button"
          onClick={() => void handlePrimaryAction()}
          disabled={busy}
          className="rounded-md bg-[#9b3c2a] px-4 py-2 text-[13.5px] font-medium text-white hover:bg-[#863123] disabled:opacity-50"
        >
          {primaryLabel}
        </button>
      </div>
    </dialog>
  );
}
