# pag — Pip: Aventura Estelar

Un plataformas 3D para navegador hecho con [three.js](https://threejs.org) y Vite,
inspirado en los plataformas 3D clásicos de los 90. Personaje, mundos, música y
nombres son originales.

Las estrellas que mantenían a flote el reino del cielo se han dispersado. Guía a
**Pip** desde la Plaza del Cielo a través de tres mundos y recupera las 10 estrellas.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build estático en dist/ (rutas relativas, se aloja en cualquier sitio)
npm test         # pruebas de física, movimientos, LOD y matemáticas (node --test)
```

## Controles

| Tecla | Acción |
|-------|--------|
| `W A S D` / flechas | Mover (relativo a la cámara) |
| Ratón (clic para capturar) o arrastrar | Cámara · rueda para zoom |
| `Espacio` / `K` | Saltar (A) |
| `E` / `J` / clic izquierdo | Puñetazo, patada, plancha (B) |
| `Shift` / `C` / clic derecho | Agacharse; en el aire, culatazo (Z) |
| `P` / `Esc` | Pausa |
| `Q` · `F3` · `H` · `M` | Calidad · estadísticas · colisionadores · sonido |

En móvil aparecen un joystick, una zona para mover la cámara y los botones A, B y Z.
`?quality=low` o `?quality=high` fuerzan la calidad.

## Movimientos

| Movimiento | Cómo |
|------------|------|
| Salto doble y triple | Salta justo al aterrizar; el triple necesita ir corriendo |
| Salto largo | Corriendo: `Shift` + `Espacio` |
| Voltereta hacia atrás | Quieto y agachado: `Espacio` |
| Voltereta lateral | Corriendo, gira en seco hacia atrás y salta durante el derrape |
| Salto de pared | Salta contra una pared y pulsa `Espacio` al tocarla |
| Culatazo | En el aire: `Shift` |
| Plancha | Corriendo: `E` (salta durante el deslizamiento para rodar) |
| Combo de golpes | `E`, `E`, `E` en el suelo |

Pisar a los enemigos los derrota (mantén `Espacio` para rebotar más alto). Cada moneda
cura una porción del medidor de salud, cada 50 monedas dan una vida extra y recoger las
8 monedas rojas de un mundo hace aparecer una estrella.

## Mundos

| Mundo | Portal | Estrellas |
|-------|--------|-----------|
| Plaza del Cielo (central) | — | Lo alto de la Torre del Cielo |
| Colinas Brisa | abierto | La cima del Pico Brisa · 8 monedas rojas · ¡Derrota al Rey Pedrusco! |
| Fortaleza Celeste | ★ 2 | Cima de la fortaleza · Monedas rojas entre las nubes · El pozo de los saltos de pared |
| Caldera Ardiente | ★ 5 | La corona del volcán · Monedas rojas sobre la lava · El islote de las barras de fuego |

El progreso (estrellas) se guarda en el navegador.

## Estructura

```
src/
  main.js, game.js       arranque, flujo (título → plaza ↔ mundos), vidas, HUD, guardado
  core/                  matemáticas y ruido, entrada, sonido y música chiptune generados
  physics/physics.js     hash espacial, cajas/esferas/cilindros, plataformas móviles, raycasts
  camera/                cámara en tercera persona con brazo elástico y seguimiento automático
  entities/hero.js       Pip: máquina de estados con todo el repertorio de movimientos
  entities/enemies.js    Bellotín, Zumbón, Rey Pedrusco (jefe) y barras de fuego
  entities/collectibles.js  monedas instanciadas, estrellas, partículas
  world/                 terreno, constructor de niveles (batching estático), árboles con LOD
  levels/                un archivo por mundo + registro de estrellas
  render/                shaders (agua, lava, toon, cielo, portales), texturas procedurales
tests/                   pruebas con node:test
```

## Técnica

- **Batching**: toda la geometría estática de un mundo se fusiona por material, así que un
  nivel entero son unas pocas llamadas de dibujo; monedas y árboles usan `InstancedMesh`.
- **LOD + frustum culling** por instancia para el bosque (modelo completo → simplificado → billboard).
- **Colisionadores simples**: cajas, esferas y cilindros detrás de visuales detallados; el terreno
  es un heightfield en lugar de una malla.
- **Shaders propios**: agua con espuma en la orilla, lava animada, sombreado toon, cielo en degradado y portales.
- **Sombras**: un único frustum de sombra que sigue a Pip (ajustado a texel para que no parpadee) y una
  sombra circular bajo el personaje, la señal de profundidad clásica del género.
- **Simulación a 60 Hz fija**, independiente de la tasa de refresco.
