"""Minimal reader for Melee HSD .dat fighter costume files (JOBJ/DOBJ/MOBJ/POBJ)."""
import struct, math

class Dat:
    def __init__(self, path):
        self.raw = open(path, 'rb').read()
        fs, ds, rc, roc, refc = struct.unpack('>5I', self.raw[:20])
        self.data = self.raw[0x20:0x20 + ds]
        rt = 0x20 + ds
        self.relocs = set(struct.unpack('>%dI' % rc, self.raw[rt:rt + rc * 4]))
        ro = rt + rc * 4; st = ro + (roc + refc) * 8
        self.roots = {}
        for i in range(roc):
            o, so = struct.unpack('>2I', self.raw[ro + i * 8:ro + i * 8 + 8])
            self.roots[self.cstr_abs(st + so)] = o
    def cstr_abs(self, a): return self.raw[a:self.raw.index(b'\0', a)].decode('ascii', 'replace')
    def u8(self, o): return self.data[o]
    def u16(self, o): return struct.unpack_from('>H', self.data, o)[0]
    def s16(self, o): return struct.unpack_from('>h', self.data, o)[0]
    def u32(self, o): return struct.unpack_from('>I', self.data, o)[0]
    def f32(self, o): return struct.unpack_from('>f', self.data, o)[0]
    def ptr(self, o):
        return self.u32(o) if o in self.relocs else None

def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def srt_matrix(s, r, t):
    cx, sx = math.cos(r[0]), math.sin(r[0]); cy, sy = math.cos(r[1]), math.sin(r[1]); cz, sz = math.cos(r[2]), math.sin(r[2])
    Rx = [[1,0,0,0],[0,cx,-sx,0],[0,sx,cx,0],[0,0,0,1]]
    Ry = [[cy,0,sy,0],[0,1,0,0],[-sy,0,cy,0],[0,0,0,1]]
    Rz = [[cz,-sz,0,0],[sz,cz,0,0],[0,0,1,0],[0,0,0,1]]
    S = [[s[0],0,0,0],[0,s[1],0,0],[0,0,s[2],0],[0,0,0,1]]
    T = [[1,0,0,t[0]],[0,1,0,t[1]],[0,0,1,t[2]],[0,0,0,1]]
    return mat_mul(T, mat_mul(Rz, mat_mul(Ry, mat_mul(Rx, S))))

def xform(m, v, w=1.0):
    return [m[i][0]*v[0] + m[i][1]*v[1] + m[i][2]*v[2] + m[i][3]*w for i in range(3)]

class Joint:
    pass

def read_joints(dat, root):
    joints = []; by_off = {}
    def walk(off, parent, world_parent):
        while off is not None:
            j = Joint(); j.off = off; j.index = len(joints); j.parent = parent
            j.flags = dat.u32(off + 4)
            j.rot = [dat.f32(off + 0x14 + 4*i) for i in range(3)]
            j.scale = [dat.f32(off + 0x20 + 4*i) for i in range(3)]
            j.trans = [dat.f32(off + 0x2C + 4*i) for i in range(3)]
            j.local = srt_matrix(j.scale, j.rot, j.trans)
            j.world = mat_mul(world_parent, j.local)
            j.dobj = dat.ptr(off + 0x10) if not (j.flags & 0x4000 or j.flags & 0x20) else None  # spline/ptcl flags
            j.inv_bind_ptr = dat.ptr(off + 0x38)
            joints.append(j); by_off[off] = j
            child = dat.ptr(off + 8)
            if child is not None: walk(child, j, j.world)
            off = dat.ptr(off + 0xC)
    I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]
    walk(root, None, I)
    return joints, by_off

GX_ATTR = {0:'PNMTX',9:'POS',10:'NRM',11:'CLR0',12:'CLR1',13:'TEX0',14:'TEX1',25:'NBT'}

def read_attrs(dat, off):
    attrs = []
    while True:
        name = dat.u32(off)
        if name == 0xFF: break
        a = dict(name=name, type=dat.u32(off+4), cnt=dat.u32(off+8), ctype=dat.u32(off+12),
                 scale=dat.u8(off+16), stride=dat.u16(off+18), data=dat.ptr(off+20))
        attrs.append(a); off += 0x18
    return attrs

def read_value(dat, a, idx):
    """Return attribute value (list of floats) for index idx."""
    ncomp = {9: 2 + a['cnt'], 10: 3, 13: 1 + a['cnt'], 14: 1 + a['cnt']}.get(a['name'], 0)
    if a['name'] in (11, 12):
        return None
    o = a['data'] + idx * a['stride']
    size, fmt = {0:(1,'B'),1:(1,'b'),2:(2,'H'),3:(2,'h'),4:(4,'f')}[a['ctype']]
    vals = struct.unpack_from('>' + fmt * ncomp, dat.data, o)
    if a['ctype'] != 4:
        vals = [v / float(1 << a['scale']) for v in vals]
    return list(vals)

def read_pobj(dat, off):
    p = dict(off=off, flags=dat.u16(off + 0xC))
    p['attrs'] = read_attrs(dat, dat.ptr(off + 8))
    dl = dat.ptr(off + 0x10); dlsize = dat.u16(off + 0xE) * 32
    kind = (p['flags'] >> 12) & 3
    p['kind'] = kind
    p['envelopes'] = []
    wp = dat.ptr(off + 0x14)
    if kind == 2 and wp is not None:
        i = 0
        while True:
            ep = dat.ptr(wp + i*4)
            if ep is None: break
            env = []; k = 0
            while True:
                jp = dat.ptr(ep + k*8)
                if jp is None: break
                env.append((jp, dat.f32(ep + k*8 + 4))); k += 1
            p['envelopes'].append(env); i += 1
    elif kind == 0:
        p['single'] = wp
    # display list
    tris = []; verts = []
    o = dl; end = dl + dlsize
    while o < end:
        op = dat.u8(o)
        if op == 0: break
        prim = op & 0xF8; n = dat.u16(o + 1); o += 3
        strip = []
        for _ in range(n):
            v = {}
            for a in p['attrs']:
                if a['type'] == 1:  # direct
                    if a['name'] <= 8: v[a['name']] = dat.u8(o); o += 1
                    elif a['name'] in (11, 12):
                        n_b = {0:2,1:3,2:4,3:2,4:3,5:4}[a['ctype']]; o += n_b
                    else: raise ValueError('direct attr %d' % a['name'])
                elif a['type'] == 2: v[a['name']] = dat.u8(o); o += 1
                elif a['type'] == 3: v[a['name']] = dat.u16(o); o += 2
            strip.append(len(verts)); verts.append(v)
        if prim == 0x90:
            tris += [tuple(strip[i:i+3]) for i in range(0, n - 2, 3)]
        elif prim == 0x98:
            for i in range(n - 2):
                tris.append((strip[i], strip[i+1], strip[i+2]) if i % 2 == 0 else (strip[i+1], strip[i], strip[i+2]))
        elif prim == 0xA0:
            tris += [(strip[0], strip[i], strip[i+1]) for i in range(1, n - 1)]
        elif prim == 0x80:
            for i in range(0, n, 4): tris += [(strip[i], strip[i+1], strip[i+2]), (strip[i], strip[i+2], strip[i+3])]
        else:
            raise ValueError('prim %x' % prim)
    p['verts'] = verts; p['tris'] = tris
    return p

def read_mobj(dat, off):
    m = dict(off=off, flags=dat.u32(off+4))
    tex = dat.ptr(off + 8); texs = []
    while tex is not None:
        img = dat.ptr(tex + 0x4C)
        t = dict(off=tex, img=None)
        if img is not None:
            t['img'] = dict(off=img, data=dat.ptr(img), w=dat.u16(img+4), h=dat.u16(img+6), fmt=dat.u32(img+8))
        t['tlut'] = dat.ptr(tex + 0x50)
        texs.append(t); tex = dat.ptr(tex + 4)
    m['textures'] = texs
    mat = dat.ptr(off + 0xC)
    if mat is not None:
        m['diffuse'] = tuple(dat.data[mat + 4: mat + 8])
    return m
