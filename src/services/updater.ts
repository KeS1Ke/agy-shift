import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import * as api from './tauri';
import { useAppStore } from '../stores/useAppStore';

let activeUpdate: Update | null = null;
let inFlightCheck: Promise<void> | null = null;
let inFlightDownload: Promise<void> | null = null;

async function replaceActiveUpdate(next: Update | null): Promise<void> {
  const previous = activeUpdate;
  activeUpdate = next;
  if (previous && previous !== next) {
    await previous.close().catch(() => {});
  }
}

export async function checkAppUpdate(options?: {
  silent?: boolean;
  autoDownload?: boolean;
}): Promise<void> {
  const silent = Boolean(options?.silent);
  const autoDownload = Boolean(options?.autoDownload);

  if (inFlightCheck) {
    return inFlightCheck;
  }

  const currentStatus = useAppStore.getState().updateStatus;
  if (currentStatus === 'downloading' || currentStatus === 'installing') {
    return;
  }

  const run = (async () => {
    const prevVersion = useAppStore.getState().availableUpdateVersion;
    const prevReady = useAppStore.getState().updateStatus === 'ready';

    if (!silent) {
      useAppStore.setState({
        updateStatus: 'checking',
        updateStatusMessage: '',
        updateProgress: null,
      });
    }

    try {
      const next = await check({ timeout: 15_000 });
      void api.updateLastCheckTime().catch(() => {});

      if (!next) {
        await replaceActiveUpdate(null);
        useAppStore.setState({
          updateStatus: 'idle',
          availableUpdateVersion: null,
          availableUpdateBody: '',
          updateProgress: null,
          updateStatusMessage: silent ? '' : '当前已是最新版本',
        });
        return;
      }

      if (prevReady && prevVersion === next.version && activeUpdate) {
        await next.close().catch(() => {});
        useAppStore.setState({
          updateStatus: 'ready',
          updateStatusMessage: `新版本 v${next.version} 已下载完成，点击立即安装`,
        });
        return;
      }

      await replaceActiveUpdate(next);
      useAppStore.setState({
        updateStatus: 'available',
        availableUpdateVersion: next.version,
        availableUpdateBody: next.body ?? '',
        updateProgress: null,
        updateStatusMessage: `发现新版本 v${next.version}`,
      });

      if (autoDownload) {
        await downloadAppUpdate({ silent });
      }
    } catch (error) {
      if (!silent) {
        useAppStore.setState({
          updateStatus: activeUpdate ? (prevReady ? 'ready' : 'available') : 'idle',
          updateStatusMessage: `检查更新失败：${String(error)}`,
        });
      }
    } finally {
      inFlightCheck = null;
    }
  })();

  inFlightCheck = run;
  return run;
}

export async function downloadAppUpdate(options?: { silent?: boolean }): Promise<boolean> {
  const silent = Boolean(options?.silent);
  const target = activeUpdate;
  if (!target) {
    return false;
  }
  if (useAppStore.getState().updateStatus === 'ready') {
    return true;
  }
  if (inFlightDownload) {
    await inFlightDownload;
    return useAppStore.getState().updateStatus === 'ready';
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  const onEvent = (event: DownloadEvent) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength ?? 0;
      downloadedBytes = 0;
      useAppStore.setState({ updateProgress: totalBytes > 0 ? 0 : null });
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      if (totalBytes > 0) {
        const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
        useAppStore.setState({ updateProgress: pct });
      }
    } else if (event.event === 'Finished') {
      useAppStore.setState({ updateProgress: 100 });
    }
  };

  useAppStore.setState({
    updateStatus: 'downloading',
    updateProgress: null,
    updateStatusMessage: `正在后台下载新版本 v${target.version}…`,
  });

  const run = (async () => {
    try {
      await target.download(onEvent);
      useAppStore.setState({
        updateStatus: 'ready',
        updateProgress: 100,
        updateStatusMessage: `新版本 v${target.version} 已下载完成，点击立即安装`,
      });
    } catch (error) {
      useAppStore.setState({
        updateStatus: 'available',
        updateProgress: null,
        updateStatusMessage: silent
          ? `发现新版本 v${target.version}`
          : `下载更新失败：${String(error)}`,
      });
    } finally {
      inFlightDownload = null;
    }
  })();

  inFlightDownload = run;
  await run;
  return useAppStore.getState().updateStatus === 'ready';
}

export async function installAppUpdate(): Promise<void> {
  const target = activeUpdate;
  if (!target) {
    return;
  }
  const status = useAppStore.getState().updateStatus;
  if (status === 'installing') {
    return;
  }

  if (status !== 'ready') {
    const ok = await downloadAppUpdate({ silent: false });
    if (!ok) {
      return;
    }
  }

  useAppStore.setState({
    updateStatus: 'installing',
    updateStatusMessage: '正在安装更新并重启…',
  });
  try {
    await target.install();
    await api.relaunchAfterUpdate();
  } catch (error) {
    useAppStore.setState({
      updateStatus: 'ready',
      updateStatusMessage: `安装更新失败：${String(error)}`,
    });
  }
}
