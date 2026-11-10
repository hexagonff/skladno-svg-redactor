import './App.css';

export default function App() {
  return (
    <main className="workspace" aria-label="Редактор">
      <aside className="workspace__panel" aria-labelledby="library-title">
        <h2 id="library-title">Библиотека</h2>
      </aside>
      <section className="workspace__canvas" aria-labelledby="canvas-title">
        <h2 id="canvas-title">Холст</h2>
      </section>
      <aside className="workspace__panel" aria-labelledby="settings-title">
        <h2 id="settings-title">Настройки</h2>
      </aside>
    </main>
  );
}
