"""Render the rigged Emilia (optionally posed) next to Falco, front and side."""
import bpy, sys, math
args = sys.argv[sys.argv.index('--') + 1:]
rig_blend, falco_blend, out, pose = args[:4]
bpy.ops.wm.open_mainfile(filepath=rig_blend)
sc = bpy.context.scene
with bpy.data.libraries.load(falco_blend) as (src, dst): dst.objects = ['Falco_mesh', 'Falco_skeleton']
for o in dst.objects:
    sc.collection.objects.link(o)
fsk = bpy.data.objects['Falco_skeleton.001'] if 'Falco_skeleton.001' in bpy.data.objects else None
fsk.location.x = 22
ao = bpy.data.objects['Falco_skeleton']
if pose == 'test':
    import mathutils
    for sk in (ao, fsk):
        pb = sk.pose.bones
        pb['JOBJ_23'].rotation_mode = 'XYZ'; pb['JOBJ_23'].rotation_euler = (0, 0, math.radians(-60))
        pb['JOBJ_24'].rotation_mode = 'XYZ'; pb['JOBJ_24'].rotation_euler = (0, 0, math.radians(-70))
        pb['JOBJ_6'].rotation_mode = 'XYZ'; pb['JOBJ_6'].rotation_euler = (math.radians(-60), 0, 0)
        pb['JOBJ_7'].rotation_mode = 'XYZ'; pb['JOBJ_7'].rotation_euler = (math.radians(80), 0, 0)
        pb['JOBJ_39'].rotation_mode = 'XYZ'; pb['JOBJ_39'].rotation_euler = (0, math.radians(30), 0)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16
sc.render.resolution_x = 1400; sc.render.resolution_y = 800
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.75, 0.8, 1)
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 44
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
L = bpy.data.lights.new('l', 'SUN'); L.energy = 3; lo = bpy.data.objects.new('l', L); sc.collection.objects.link(lo)
lo.rotation_euler = (math.radians(50), 0, math.radians(20))
for i, view in enumerate(['front', 'side']):
    if view == 'front': co.location = (11, -60, 9); co.rotation_euler = (math.radians(90), 0, 0)
    else: co.location = (-60, 0, 9); co.rotation_euler = (math.radians(90), 0, math.radians(-90))
    if view == 'side': fsk.location = (0, 15, 0)
    sc.render.filepath = out + '_' + view + '.png'; bpy.ops.render.render(write_still=True)
