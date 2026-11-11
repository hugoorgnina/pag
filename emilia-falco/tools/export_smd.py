"""Write the rigged Emilia as a Valve SMD with Falco's exact joint hierarchy (JOBJ_n) for HSDRaw."""
import bpy, sys, os, shutil
args = sys.argv[sys.argv.index('--') + 1:]
rig_blend, datpath, out_smd, tooldir = args[:4]
sys.path.insert(0, tooldir)
from hsd import Dat, read_joints
dat = Dat(datpath)
joints, _ = read_joints(dat, dat.roots['PlyFalco5KBu_Share_joint'])
bpy.ops.wm.open_mainfile(filepath=rig_blend)
outdir = os.path.dirname(out_smd)
L = ['version 1', 'nodes']
for j in joints:
    L.append('%d "JOBJ_%d" %d' % (j.index, j.index, j.parent.index if j.parent else -1))
L += ['end', 'skeleton', 'time 0']
for j in joints:
    L.append('%d %.6f %.6f %.6f %.6f %.6f %.6f' % (j.index, *j.trans, *j.rot))
L += ['end', 'triangles']
ntri = 0
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    me = o.data; me.calc_loop_triangles()
    gname = {g.index: g.name for g in o.vertex_groups}
    for tri in me.loop_triangles:
        mat = o.material_slots[tri.material_index].material if o.material_slots else None
        tex = None
        if mat and mat.node_tree:
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and n.outputs[0].links:
                    tex = os.path.basename(n.image.filepath)
                    src = bpy.path.abspath(n.image.filepath)
                    if os.path.exists(src) and not os.path.exists(os.path.join(outdir, tex)):
                        shutil.copy(src, os.path.join(outdir, tex))
        if tex is None:  # untextured material: bake its flat colour into a tiny texture
            c = mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value if mat and mat.node_tree else (0.8, 0.8, 0.8, 1)
            rgb = tuple(int(round(255 * (x ** (1 / 2.2)))) for x in c[:3])
            tex = 'color_%02x%02x%02x.png' % rgb
            path = os.path.join(outdir, tex)
            if not os.path.exists(path):
                img = bpy.data.images.new(tex, 8, 8); img.pixels = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1.0] * 64
                img.filepath_raw = path; img.file_format = 'PNG'; img.save()
        L.append(tex)
        for li, vi in zip(tri.loops, tri.vertices):
            v = me.vertices[vi]; nrm = me.corner_normals[li].vector if hasattr(me, 'corner_normals') else v.normal
            uv = me.uv_layers.active.data[li].uv if me.uv_layers.active else (0, 0)
            links = [(int(gname[g.group].split('_')[1]), g.weight) for g in v.groups if g.weight > 0.001]
            tot = sum(w for _, w in links) or 1.0
            links = [(b, w / tot) for b, w in links]
            L.append('0 %.6f %.6f %.6f %.6f %.6f %.6f %.6f %.6f %d %s' % (
                v.co.x, v.co.y, v.co.z, nrm.x, nrm.y, nrm.z, uv[0], uv[1], len(links),
                ' '.join('%d %.6f' % lw for lw in links)))
        ntri += 1
L.append('end')
open(out_smd, 'w').write('\n'.join(L) + '\n')
print('smd triangles', ntri)
