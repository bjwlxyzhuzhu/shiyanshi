import { useEffect, useState } from 'react';
import { Experiment } from './pages/Experiment';
import { Login } from './pages/Login';
import { useSessionStore } from './stores/session';
import { interactWith, placeAtCurrentTask } from './world/actions';
import { installInput } from './world/input';
import { useSceneState } from './world/sceneAdapter';
import { WorldCanvas } from './world/WorldCanvas';
import { useWorldStore, webglSupported } from './world/worldStore';

/**
 * 同一个持续存在的世界 Canvas：登录前作为静止展示镜头，登录后成为实验基地；
 * 24 步期间不卸载、不重建。WebGL 不可用时改用 HTML 实验模式。
 */
export function App() {
  const token = useSessionStore((state) => state.token);
  const htmlMode = useWorldStore((state) => state.htmlMode);
  const setHtmlMode = useWorldStore((state) => state.setHtmlMode);
  const [webgl] = useState(() => webglSupported());
  const [ilabError, setIlabError] = useState<string | null>(null);
  const scene = useSceneState();

  // 实验空间入口：后端换票后 303 到 ?ilab=1（不含 ticket），这里用一次性 handoff 建立本系统登录
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clean = () => window.history.replaceState(null, '', window.location.pathname);
    if (params.get('ilab') === '1') {
      clean();
      void useSessionStore.getState().bootstrapIlab().then((ok) => {
        if (!ok) setIlabError('handoff_invalid');
      });
    } else if (params.get('ilab_error')) {
      setIlabError(params.get('ilab_error'));
      clean();
    }
  }, []);

  useEffect(() => {
    installInput();
    if (!webgl) setHtmlMode(true, '当前浏览器无法创建 WebGL 三维上下文，已使用 HTML 实验模式；实验字段、提交与评分完全相同。');
  }, [webgl, setHtmlMode]);

  // 退出登录后回到展示镜头
  useEffect(() => {
    if (token) return;
    const world = useWorldStore.getState();
    placeAtCurrentTask('S01', false);
    world.setMode('attract');
    world.setDrawer('none');
  }, [token]);

  const show3d = webgl && !htmlMode;
  return (
    <div className="stage">
      {show3d ? (
        <WorldCanvas
          scene={scene}
          onInteract={interactWith}
          onContextLost={(reason) => setHtmlMode(true, reason)}
        />
      ) : (
        <div className="backdrop-static" aria-hidden />
      )}
      {token ? <Experiment scene={scene} /> : <Login ilabError={ilabError} />}
    </div>
  );
}
