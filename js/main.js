// ============================================================
//  Point d'entrée : écrans et boucle principale
// ============================================================
(function () {
  let last = performance.now();
  let difficulty = 'normal';

  function frame(t) {
    const real = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (G.running && !G.paused && !G.over) {
      let sim = real * G.speed;
      while (sim > 0) {
        const step = Math.min(0.05, sim);
        updateGame(step);
        sim -= step;
        if (G.over) break;
      }
    }
    Input.update(real);
    if (G.running) Render.draw();
    UI.update(real);
    requestAnimationFrame(frame);
  }

  window.addEventListener('load', () => {
    Render.init();
    UI.init();
    Input.init();

    document.querySelectorAll('.diff').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.diff').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      difficulty = b.dataset.d;
    }));
    const start = () => {
      Sound.init();
      const seedIn = document.getElementById('seed').value.trim();
      const seed = seedIn ? (parseInt(seedIn, 10) || [...seedIn].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : Math.floor(Math.random() * 1e9);
      document.getElementById('start').classList.remove('show');
      document.getElementById('loading').classList.add('show');
      setTimeout(() => {
        startGame(difficulty, seed);
        document.getElementById('loading').classList.remove('show');
      }, 30);
    };
    document.getElementById('start-btn').addEventListener('click', start);
    document.getElementById('restart-btn').addEventListener('click', () => location.reload());
    document.getElementById('p-resume').addEventListener('click', () => UI.togglePause(false));
    document.getElementById('p-restart').addEventListener('click', () => location.reload());
    document.getElementById('p-help').addEventListener('click', () => document.getElementById('help').classList.toggle('open'));
    document.getElementById('p-sound').addEventListener('click', e => { Sound.enabled = !Sound.enabled; e.target.textContent = 'Son : ' + (Sound.enabled ? 'activé' : 'coupé'); });
    document.getElementById('p-speed').addEventListener('click', e => {
      G.speed = G.speed === 1 ? 1.5 : G.speed === 1.5 ? 2 : 1;
      e.target.textContent = 'Vitesse : x' + G.speed;
    });
    document.getElementById('p-reveal').addEventListener('click', e => {
      Fog.revealAll = !Fog.revealAll; Fog.update();
      e.target.textContent = 'Révéler la carte : ' + (Fog.revealAll ? 'oui' : 'non');
    });
    requestAnimationFrame(frame);
  });
})();
