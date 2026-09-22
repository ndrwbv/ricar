import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

const LEVELS_DIR = resolve(__dirname, 'public/levels');
const TEX_DIR = resolve(__dirname, 'public/textures');

/* dev-API редактора: PUT/DELETE /__api/levels/:id пишет и удаляет public/levels/<id>.json и обновляет index.json */
function levelsApi() {
  return {
    name: 'knight-levels-api',
    configureServer(server) {
      // PUT /__api/textures/<name>?sprite=1 — тело: PNG (binary); пишет public/textures/<name>.png и index.json
      server.middlewares.use(async (req, res, next) => {
        const mt = req.url.match(/^\/__api\/textures\/([\w.-]+)(\?.*)?$/);
        if (!mt) return next();
        const name = mt[1], sprite = /sprite=1/.test(mt[2] || '');
        fs.mkdirSync(TEX_DIR, { recursive: true });
        const idxFile = resolve(TEX_DIR, 'index.json');
        const readIdx = () => { try { return JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) { return []; } };
        if (req.method === 'PUT') {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            fs.writeFileSync(resolve(TEX_DIR, `${name}.png`), Buffer.concat(chunks));
            const idx = readIdx().filter(t => t.name !== name); idx.push({ name, file: `${name}.png`, sprite });
            fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
            res.statusCode = 200; res.end('ok');
          });
          return;
        }
        if (req.method === 'DELETE') {
          const f = resolve(TEX_DIR, `${name}.png`); if (fs.existsSync(f)) fs.unlinkSync(f);
          fs.writeFileSync(idxFile, JSON.stringify(readIdx().filter(t => t.name !== name), null, 1));
          res.statusCode = 200; res.end('ok'); return;
        }
        next();
      });
      server.middlewares.use(async (req, res, next) => {
        const m = req.url.match(/^\/__api\/levels\/([\w.-]+)$/);
        if (!m) return next();
        const id = m[1];
        const file = resolve(LEVELS_DIR, `${id}.json`);
        const reindex = () => {
          const list = fs.readdirSync(LEVELS_DIR).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => {
            try { const d = JSON.parse(fs.readFileSync(resolve(LEVELS_DIR, f), 'utf8')); return { id: d.id || f.replace('.json', ''), name: d.name || d.id }; }
            catch (e) { return null; }
          }).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
          fs.writeFileSync(resolve(LEVELS_DIR, 'index.json'), JSON.stringify(list, null, 1));
        };
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            try { JSON.parse(body); fs.mkdirSync(LEVELS_DIR, { recursive: true }); fs.writeFileSync(file, body); reindex(); res.statusCode = 200; res.end('ok'); }
            catch (e) { res.statusCode = 400; res.end(String(e)); }
          });
          return;
        }
        if (req.method === 'DELETE') {
          try { if (fs.existsSync(file)) fs.unlinkSync(file); reindex(); res.statusCode = 200; res.end('ok'); }
          catch (e) { res.statusCode = 500; res.end(String(e)); }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',                     // Electron открывает dist/*.html по file://
  plugins: [levelsApi()],
  build: {
    target: 'esnext', outDir: 'dist', assetsInlineLimit: 0, sourcemap: false,
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), game: resolve(__dirname, 'game.html'), editor: resolve(__dirname, 'editor.html'), pad: resolve(__dirname, 'pad.html') } },
  },
  server: { host: '127.0.0.1' },
  // адд-оны three должны попасть в тот же предсобранный чанк, иначе Vite создаёт второй экземпляр three
  optimizeDeps: { include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/BufferGeometryUtils.js'] },
});
