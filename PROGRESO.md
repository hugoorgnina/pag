# Progreso: mods de Smash Bros. Melee

Resumen para continuar en otra sesión de Claude que se ejecute **en el PC del
usuario** (Claude Desktop / Claude Code local), con acceso a las ISO y a DAT
Texture Wizard.

La sesión anterior corría en la nube, sin acceso al PC, así que no ha tocado
ninguna ISO ni ningún `.dat`.

## Contexto

- El usuario tiene dos ISO de Melee: una **con mods** y otra **original sin mods**.
- Tiene **DAT Texture Wizard** (carpeta "WIZARD") en el PC.
- En la ISO con mods hay una skin de **Miku sobre Marth** (no la hizo Claude, ya la tenía).
- Ninguno de estos archivos está en este repositorio.

## Tarea 1: quitar la Miku de Marth (pendiente, no se sabe si se hizo)

Objetivo: el traje de Marth que tiene la skin de Miku debe volver a ser el
Marth original, **sin tocar ningún otro mod**.

1. Copia de seguridad de la ISO con mods.
2. Comparar los archivos de Marth entre las dos ISO (`PlMsNr/Re/Gr/Bk/Wh.dat`,
   y también `PlMs.dat` y `PlMsAJ.dat`) para ver cuál es el de Miku. El de Miku
   tiene texturas turquesa.
3. Sustituir **solo** ese `PlMs__.dat` por el de la ISO original:
   - Con DAT Texture Wizard: Disc File Tree → Export desde la ISO original →
     Import/Replace en la ISO con mods → Save.
   - O con un script que lea la FST (offset en 0x424, tamaño en 0x428). Si el
     archivo no cabe en su hueco, se añade al final alineado a 0x8000 y se
     actualiza la FST.
4. Si el retrato (`MnSlChr.usd`) o el icono (`IfAll.usd`) también son de Miku,
   restaurar **solo esa textura**, nunca el archivo entero.
5. Verificar que el resto de archivos tienen el mismo hash que en el backup.

## Tarea 2: skin de Emilia para el Falco azul (en curso)

Objetivo: sustituir el modelo del **Falco azul** (`PlFcBu.dat`) por **Emilia**
(Re:Zero, versión con mono morado y botas blancas).

### Hecho

Todo está en [`emilia-falco/`](emilia-falco/) (rama `claude/focused-babbage-3bxlhh`):

- Modelo de origen: "Emilia Re:Zero 3D model" de aliensarereal12 (zip subido
  por el usuario: FBX + 8 texturas, **sin esqueleto**).
- `emilia_melee.fbx` / `emilia_melee.blend`: modelo optimizado.
  - De 18.705 a **6.088 triángulos** (decimado por pieza; los ojos, las cejas
    y el broche sin tocar).
  - Shape keys eliminados (Melee no los usa).
  - Material duplicado de los accesorios del pelo unificado. `Material.004`
    (6 caras, su textura faltaba en el zip) pasa a color plano.
  - Centrado, con los pies en Z=0. El FBX se exporta con Y arriba.
- `textures/`: texturas en potencia de 2 (face, hair, top y hair_accessories
  a 256 px; eyes, bodysuit y shoes a 128 px; badge a 64 px).
- `preview/comparacion.png`: render del original y del optimizado.
- `tools/`: scripts de Blender (`bpy` 5.0 + Pillow):
  - `optimize.py`: decimado, texturas y exportación.
  - `render_prev.py`: renders de vista previa.
  - `fbx_info.py`: estadísticas del FBX.

### Pendiente

1. **Conseguir `PlFcBu.dat`** de la ISO sin mods (DAT Texture Wizard → Disc
   File Tree → clic derecho → Export).
2. **Riggear a Emilia al esqueleto de Falco:**
   - Abrir `PlFcBu.dat` en HSDRaw y exportar el modelo de Falco con su esqueleto.
   - Escalar y alinear a Emilia a su altura y pose.
   - Asignar los pesos copiándolos de la malla de Falco (Data Transfer en
     Blender) o con pesos automáticos, y repasarlos.
   - Ojo: Falco tiene piernas de pájaro (dobladas hacia atrás) y Emilia
     piernas humanas; con sus animaciones pueden verse raras.
3. **Importar en HSDRaw** sobre `PlFcBu.dat` (Import Model From File) con las
   texturas de `textures/`. Revisar los materiales y guardar.
4. **Meter el nuevo `PlFcBu.dat` en la ISO con mods** con DAT Texture Wizard
   (Import/Replace), solo ese archivo. Hacer copia de seguridad antes.
5. Opcional: retrato del Falco azul en `MnSlChr.usd` (solo esa textura) e
   icono en `IfAll.usd`.
6. Probar en Dolphin.

### Alternativa más sencilla (si el modelo da problemas)

Hacer una retextura de Falco con los colores de Emilia, sin cambiar el modelo.
Paleta sacada de la imagen de referencia:

| Parte | Color |
| --- | --- |
| Mono | `#724FC5` (sombra `#5A3BA3`, brillo `#8F72D8`) |
| Mangas / chaqueta | `#E4E2F5` (sombra `#C9C6E6`) |
| Pelo / plumas | `#C8C6DE` (brillo `#ECEBF8`) |
| Botas | `#D8D8F3`, con borde y suela en `#724FC5` |
| Puños | rosa `#E07A9A` con rayas blancas |
| Lazos | `#3E2A6E` |
| Broche / metales | dorado `#D9A53A` |
| Ojos | `#8E6FC8` |

## Reglas que pidió el usuario

- **No tocar nada más** que el archivo del personaje en cuestión.
- Copia de seguridad antes de modificar una ISO; nunca modificar la ISO original.
- No subir ISO al repositorio (pesan demasiado y tienen copyright). Solo `.dat` sueltos o PNG.
