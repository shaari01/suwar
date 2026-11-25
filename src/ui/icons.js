// أيقونات Lucide (رخصة ISC) تُضمَّن في الحزمة فتعمل بلا إنترنت
import {
  createElement,
  Undo2, Redo2, ImagePlus, Download, Move, Hand, Scissors, Brush, Eraser, Layers, Library, Sparkles,
  Eye, EyeOff, Lock, LockOpen, Trash2, Copy, FolderPlus, Plus, Merge, Settings, Menu, X, Check,
  ZoomIn, ZoomOut, Maximize, SlidersHorizontal, Wand2, MousePointerClick, Sun, Contrast, Droplet,
  Stamp, Bandage, Grid3x3, Pin, Spline, FolderOpen, Save, FilePlus, ChevronDown, ChevronLeft,
  ChevronUp, ArrowUp, ArrowDown, Image as ImageIcon, Palette, Cloud, Search, Star, Info, RotateCcw,
  FlipHorizontal2, Crop, Blend, Moon, Lasso, Paintbrush, Circle, Square, Tag, Upload, Share2, Film,
  CircleHelp, Aperture, Shapes, Group, Ungroup, Layers2, Focus, Waves, ScanLine, BoxSelect, Footprints,
  PersonStanding, SunMedium, Eraser as EraserIcon, LayoutGrid, MoreVertical, Smartphone, Monitor
} from 'lucide';

const MAP = {
  undo: Undo2, redo: Redo2, import: ImagePlus, export: Download, move: Move, hand: Hand, cut: Scissors,
  brush: Brush, eraser: Eraser, layers: Layers, library: Library, ai: Sparkles, eye: Eye, eyeOff: EyeOff,
  lock: Lock, unlock: LockOpen, trash: Trash2, copy: Copy, group: FolderPlus, plus: Plus, merge: Merge,
  settings: Settings, menu: Menu, x: X, check: Check, zoomIn: ZoomIn, zoomOut: ZoomOut, fit: Maximize,
  sliders: SlidersHorizontal, wand: Wand2, click: MousePointerClick, sun: Sun, contrast: Contrast,
  droplet: Droplet, stamp: Stamp, heal: Bandage, grid: Grid3x3, pin: Pin, spline: Spline, open: FolderOpen,
  save: Save, newFile: FilePlus, down: ChevronDown, left: ChevronLeft, up: ChevronUp, arrowUp: ArrowUp,
  arrowDown: ArrowDown, image: ImageIcon, palette: Palette, cloud: Cloud, search: Search, star: Star,
  info: Info, reset: RotateCcw, flip: FlipHorizontal2, crop: Crop, blend: Blend, moon: Moon, lasso: Lasso,
  paint: Paintbrush, circle: Circle, square: Square, tag: Tag, upload: Upload, share: Share2, film: Film,
  help: CircleHelp, aperture: Aperture, shapes: Shapes, groupIcon: Group, ungroup: Ungroup, layers2: Layers2,
  focus: Focus, waves: Waves, scan: ScanLine, boxSelect: BoxSelect, footprints: Footprints,
  person: PersonStanding, sunMedium: SunMedium, erase: EraserIcon, gridLayout: LayoutGrid, more: MoreVertical,
  phone: Smartphone, monitor: Monitor
};

export function icon(name, size = 26) {
  const def = MAP[name] || CircleHelp;
  const el = createElement(def);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('ic');
  return el;
}
