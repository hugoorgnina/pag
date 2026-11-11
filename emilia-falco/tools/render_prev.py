import bpy, sys, math
src, out = sys.argv[sys.argv.index('--')+1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=src)
else: bpy.ops.wm.open_mainfile(filepath=src)
sc=bpy.context.scene
for o in list(bpy.data.objects):
    if o.type in ('CAMERA','LIGHT'): bpy.data.objects.remove(o)
meshes=[o for o in sc.objects if o.type=='MESH']
import mathutils
pts=[o.matrix_world@mathutils.Vector(c) for o in meshes for c in o.bound_box]
mn=mathutils.Vector([min(p[i] for p in pts) for i in range(3)]); mx=mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
ctr=(mn+mx)/2; h=mx.z-mn.z
sc.render.engine='CYCLES'; sc.cycles.samples=16; sc.cycles.device='CPU'
sc.render.resolution_x=600; sc.render.resolution_y=800
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True
w.node_tree.nodes['Background'].inputs[0].default_value=(0.75,0.75,0.8,1); w.node_tree.nodes['Background'].inputs[1].default_value=1.2
cam=bpy.data.cameras.new('c'); cam.type='ORTHO'; cam.ortho_scale=h*1.1
co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
L=bpy.data.lights.new('l','SUN'); L.energy=3; lo=bpy.data.objects.new('l',L); sc.collection.objects.link(lo); lo.rotation_euler=(math.radians(50),0,math.radians(20))
for i,ang in enumerate([0,180]):
    a=math.radians(ang); d=5
    co.location=(ctr.x+d*math.sin(a)*0, ctr.y - d*math.cos(a), ctr.z)
    co.rotation_euler=(math.radians(90),0,a)
    sc.render.filepath=out+f'_{i}.png'; bpy.ops.render.render(write_still=True)
