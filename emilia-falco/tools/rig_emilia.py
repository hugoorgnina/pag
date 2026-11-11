"""Retarget the optimized Emilia model onto Falco's bind pose and skin it to Falco's joints.

Usage: python rig_emilia.py -- emilia_melee.blend PlFcBu.dat out.blend out.fbx tooldir
"""
import bpy, sys, math, mathutils
from mathutils import Vector, Matrix
args = sys.argv[sys.argv.index('--') + 1:]
emilia_blend, datpath, out_blend, out_fbx, tooldir = args[:5]
sys.path.insert(0, tooldir)
from hsd import Dat, read_joints

S = 10.5  # metres -> Melee units

dat = Dat(datpath)
joints, _ = read_joints(dat, dat.roots['PlyFalco5KBu_Share_joint'])
def jpos(i):  # Melee joint world position -> Blender (Z-up) coordinates
    w = joints[i].world
    return Vector((w[0][3], -w[2][3], w[1][3]))
def m2b(x, y, z): return Vector((x, -z, y))

# ---- fit bones: Emilia segment (metres, Blender coords) -> Falco segment (Blender coords) ----
# keep_len: keep Emilia's own length (no stretch) for head and hands.
FIT = {}
def fit(name, e_h, e_t, f_h, f_t, jobj, keep_len=False):
    FIT[name] = dict(e_h=Vector(e_h) * S, e_t=Vector(e_t) * S, f_h=f_h, f_t=f_t, jobj=jobj, keep=keep_len)

fit('pelvis', (0, -0.06, 0.66), (0, -0.06, 0.80), m2b(0, 7.0, 0.2), m2b(0, 8.3, 0.0), 4)
fit('waist',  (0, -0.06, 0.80), (0, -0.06, 0.92), m2b(0, 8.3, 0.0), m2b(0, 9.43, 0.0), 18)
fit('chest',  (0, -0.06, 0.92), (0, -0.05, 1.04), m2b(0, 9.43, 0.0), m2b(0, 10.4, 0.1), 19)
fit('neck',   (0, -0.05, 1.04), (0, -0.05, 1.13), m2b(0, 10.4, 0.1), m2b(0, 11.6, 0.15), 38)
fit('head',   (0, -0.05, 1.13), (0, -0.05, 1.43), m2b(0, 11.6, 0.15), m2b(0, 15.0, 0.15), 39, keep_len=True)
for side, sx, J in (('L', 1, dict(clav=21, up=23, fore=24, hand=26, tip=28, thigh=6, knee=7, ankle=9, toe=10)),
                    ('R', -1, dict(clav=47, up=49, fore=50, hand=52, tip=54, thigh=12, knee=13, ankle=15, toe=16))):
    fit('clav_' + side, (sx * 0.03, -0.06, 1.04), (sx * 0.125, -0.05, 1.035), jpos(J['clav']), jpos(J['up']), J['clav'])
    fit('upper_' + side, (sx * 0.125, -0.05, 1.035), (sx * 0.22, -0.045, 0.925), jpos(J['up']), jpos(J['fore']), J['up'])
    fit('fore_' + side, (sx * 0.22, -0.045, 0.925), (sx * 0.30, -0.035, 0.82), jpos(J['fore']), jpos(J['hand']), J['fore'])
    fit('hand_' + side, (sx * 0.30, -0.035, 0.82), (sx * 0.36, -0.035, 0.72), jpos(J['hand']), jpos(J['tip']), J['hand'], keep_len=True)
    # legs keep Emilia's own width (knee/ankle bends happen around the lateral axis, so the
    # small sideways offset from Falco's joints does not matter); heights/depths follow Falco.
    def legpt(j, ex): p = jpos(j); return Vector((ex * S, p.y, p.z))
    hip_e = (sx * 0.065, -0.06, 0.67); knee_e = (sx * 0.08, -0.05, 0.37); ank_e = (sx * 0.085, -0.035, 0.075)
    hip_f = legpt(J['thigh'], hip_e[0]); knee_f = legpt(J['knee'], knee_e[0])
    ank_f = Vector((ank_e[0] * S, jpos(J['ankle']).y, ank_e[2] * S))  # Emilia keeps flat feet on the floor
    fit('thigh_' + side, hip_e, knee_e, hip_f, knee_f, J['thigh'])
    fit('shin_' + side, knee_e, ank_e, knee_f, ank_f, J['knee'])
    toe_e = (sx * 0.085, -0.15, 0.0)
    fit('foot_' + side, ank_e, toe_e, ank_f, ank_f + (Vector(toe_e) - Vector(ank_e)) * S, J['ankle'], keep_len=True)

for f in FIT.values():
    de = f['e_t'] - f['e_h']; df = f['f_t'] - f['f_h']
    f['u'] = de.normalized(); f['len'] = de.length
    f['rot'] = de.rotation_difference(df).to_matrix()
    f['k'] = 1.0 if f['keep'] else df.length / de.length

def map_point(f, v):
    rel = v - f['e_h']
    ax = rel.dot(f['u']); perp = rel - f['u'] * ax
    return f['f_h'] + f['rot'] @ (f['u'] * (ax * f['k']) + perp)

def seg_dist(f, v):
    a, b = f['e_h'], f['e_t']; ab = b - a
    t = max(0.0, min(1.0, (v - a).dot(ab) / ab.length_squared))
    return (v - (a + ab * t)).length

def blend(cands, v, p=4, eps=0.05):
    ws = {c: 1.0 / (seg_dist(FIT[c], v) + eps) ** p for c in cands}
    tot = sum(ws.values()); ws = {c: w / tot for c, w in ws.items()}
    top = sorted(ws.items(), key=lambda kv: -kv[1])[:3]
    tot = sum(w for _, w in top)
    return {c: w / tot for c, w in top if w / tot > 0.01}

def region_weights(objname, v_m):
    """v_m: vertex in metres (Emilia A-pose). Returns fit-bone weights (used for retarget and skinning)."""
    x, y, z = v_m; ax = abs(x); side = 'L' if x >= 0 else 'R'
    v = v_m * S
    arm = ['clav_' + side, 'upper_' + side, 'fore_' + side, 'hand_' + side]
    leg = ['thigh_' + side, 'shin_' + side, 'foot_' + side]
    if objname in ('Face', 'Eyes', 'Brows', 'Hair accessories', 'Hair braid', 'Hair'):
        return {'head': 1.0}
    if objname == 'Sleeves':
        return blend(arm, v)
    if objname == 'Shoes':
        return blend(leg, v)
    if objname in ('Top', 'Badge'):
        return blend(['waist', 'chest', 'neck'], v)
    # Bodysuit
    if z > 1.13:
        return blend(['neck', 'head'], v)
    if (z > 0.70 and ax > 0.15) or (z > 0.95 and ax > 0.115):
        return blend(arm, v)
    if z < 0.62:
        return blend(leg, v)
    if z < 0.75:
        return blend(['pelvis', 'waist', 'thigh_L', 'thigh_R'], v)
    return blend(['pelvis', 'waist', 'chest', 'neck', 'clav_L', 'clav_R'], v)

def hair_skin(z):
    # long hair follows the head near the top and the chest further down
    if z >= 1.10: return {'head': 1.0}
    if z <= 0.95: return {'chest': 1.0}
    t = (z - 0.95) / 0.15
    return {'head': t, 'chest': 1 - t}

# ---- load Emilia ----
bpy.ops.wm.open_mainfile(filepath=emilia_blend)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
skin = {}
for o in meshes:
    me = o.data; sw = []
    for vtx in me.vertices:
        vm = o.matrix_world @ vtx.co
        w = region_weights(o.name, vm)
        newp = Vector((0, 0, 0))
        for c, wt in w.items(): newp += map_point(FIT[c], vm * S) * wt
        vtx.co = o.matrix_world.inverted() @ newp
        sw.append(hair_skin(vm.z) if o.name == 'Hair' else w)
    me.update(); skin[o.name] = sw

# ---- Falco armature (Melee Y-up stored with a +90 deg X rotation, like an FBX import) ----
arm = bpy.data.armatures.new('Falco'); ao = bpy.data.objects.new('Falco_skeleton', arm)
bpy.context.scene.collection.objects.link(ao)
for o in bpy.context.selected_objects: o.select_set(False)
bpy.context.view_layer.objects.active = ao
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for j in joints:
    b = arm.edit_bones.new('JOBJ_%d' % j.index)
    w = Matrix(j.world); head = w.translation
    tail = None
    for k in joints:
        if k.parent is j and (Matrix(k.world).translation - head).length > 1e-3:
            tail = Matrix(k.world).translation; break
    if tail is None: tail = head + w.to_3x3() @ Vector((0.3, 0, 0))
    if (tail - head).length < 1e-3: tail = head + Vector((0, 0.3, 0))
    b.head, b.tail = head, tail
    if j.parent: b.parent = eb[j.parent.index]
    eb[j.index] = b
bpy.ops.object.mode_set(mode='OBJECT')
ao.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.view_layer.update()
inv = ao.matrix_world.inverted()
for o in meshes:
    # move geometry into the armature's space so the mesh can be parented without offsets
    o.data.transform(inv @ o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.parent = ao; o.matrix_parent_inverse = Matrix.Identity(4)
    for vg in list(o.vertex_groups): o.vertex_groups.remove(vg)
    groups = {}
    for vi, w in enumerate(skin[o.name]):
        for c, wt in w.items():
            name = 'JOBJ_%d' % FIT[c]['jobj']
            if name not in groups: groups[name] = o.vertex_groups.new(name=name)
            groups[name].add([vi], wt, 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = ao
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
for o in bpy.data.objects: o.select_set(True)
bpy.ops.export_scene.fbx(filepath=out_fbx, path_mode='COPY', embed_textures=False, add_leaf_bones=False,
                         axis_forward='Z', axis_up='Y', apply_scale_options='FBX_SCALE_NONE', global_scale=1.0,
                         mesh_smooth_type='FACE', use_armature_deform_only=False, primary_bone_axis='Y', secondary_bone_axis='X')
print('done', sum(len(o.data.vertices) for o in meshes), 'verts')
