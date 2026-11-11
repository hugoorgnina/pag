"""Build a Blender scene (armature + skinned mesh) from a Melee fighter costume .dat."""
import bpy, sys, os, mathutils
args = sys.argv[sys.argv.index('--') + 1:]
datpath, outblend, tooldir = args[:3]
sys.path.insert(0, tooldir)
from hsd import *
dat = Dat(datpath)
rootname = [k for k in dat.roots if k.endswith('_joint') and 'matanim' not in k][0]
joints, by_off = read_joints(dat, dat.roots[rootname])
bpy.ops.wm.read_factory_settings(use_empty=True)
M = lambda m: mathutils.Matrix(m)
# armature
arm = bpy.data.armatures.new('Falco'); ao = bpy.data.objects.new('Falco_skeleton', arm)
bpy.context.scene.collection.objects.link(ao); bpy.context.view_layer.objects.active = ao
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for j in joints:
    b = arm.edit_bones.new('JOBJ_%d' % j.index)
    w = M(j.world); head = w.translation
    kids = [k for k in joints if k.parent is j]
    tail = None
    for k in kids:
        t = M(k.world).translation
        if (t - head).length > 1e-3: tail = t; break
    if tail is None: tail = head + (w.to_3x3() @ mathutils.Vector((0.3, 0, 0)))
    if (tail - head).length < 1e-3: tail = head + mathutils.Vector((0, 0.3, 0))
    b.head, b.tail = head, tail
    if j.parent: b.parent = eb[j.parent.index]
    eb[j.index] = b
bpy.ops.object.mode_set(mode='OBJECT')
# meshes
verts = []; faces = []; weights = []; uvs = []; mats = []; matkeys = {}
for j in joints:
    d = j.dobj
    while d is not None:
        mo = dat.ptr(d + 8); po = dat.ptr(d + 0xC)
        mkey = mo
        if mkey not in matkeys: matkeys[mkey] = len(matkeys)
        while po is not None:
            p = read_pobj(dat, po)
            attrs = {a['name']: a for a in p['attrs']}
            base = len(verts)
            for v in p['verts']:
                pos = read_value(dat, attrs[9], v[9])
                if len(pos) == 2: pos = pos + [0.0]
                if p['kind'] == 2:
                    env = p['envelopes'][v.get(0, 0) // 3]
                    if len(env) == 1:
                        pos = xform(by_off[env[0][0]].world, pos)
                    wl = [(by_off[o].index, w) for o, w in env]
                else:
                    owner = by_off[p['single']] if p.get('single') is not None else j
                    pos = xform(owner.world, pos)
                    wl = [(owner.index, 1.0)]
                verts.append(pos); weights.append(wl)
                uv = read_value(dat, attrs[13], v[13]) if 13 in attrs else [0, 0]
                uvs.append((uv[0], 1 - uv[1]))
            for t in p['tris']:
                faces.append((base + t[0], base + t[2], base + t[1])); mats.append(matkeys[mkey])
            po = dat.ptr(po + 4)
        d = dat.ptr(d + 4)
me = bpy.data.meshes.new('Falco'); me.from_pydata(verts, [], faces); me.update()
uvl = me.uv_layers.new(name='UV')
for poly in me.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = uvs[me.loops[li].vertex_index]
mo = bpy.data.objects.new('Falco_mesh', me); bpy.context.scene.collection.objects.link(mo)
for j in joints: mo.vertex_groups.new(name='JOBJ_%d' % j.index)
for vi, wl in enumerate(weights):
    for ji, w in wl: mo.vertex_groups[ji].add([vi], w, 'ADD')
import math; ao.rotation_euler = (math.pi / 2, 0, 0)  # Melee is Y-up, Blender Z-up
mo.parent = ao; m = mo.modifiers.new('Armature', 'ARMATURE'); m.object = ao
bpy.ops.wm.save_as_mainfile(filepath=outblend)
print('verts', len(verts), 'faces', len(faces))
pts = [mathutils.Vector(v) for v in verts]
print('bbox', [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)])
