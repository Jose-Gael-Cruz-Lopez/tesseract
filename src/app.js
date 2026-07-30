// App shell. Builds the Notion-style frame — sidebar rail, topbar, content area
// with the globe behind a slide-over page panel — mounts every surface, and
// wires them through one `ctx` object. Two modes share this shell: Knowledge
// (the page store → notes globe) and Developer (canopy → dev sphere). The mode
// is switched from the sidebar workspace menu; only the globe + sidebar + page
// behavior differ, so the topbar/editor/comments chrome is mounted once.

import { initGraph } from './graph/graph.js';
import * as store from './data/store.js';
import * as auth from './auth/auth.js';
import { supabaseSignOut } from './data/supabase.js';
import { canopyLogout } from './data/canopy-session.js';
import { toast, el } from './ui/popover.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountTopbar } from './ui/topbar.js';
import { mountEditor } from './ui/editor.js';
import { mountComments, openShare } from './ui/share.js';
import { openSearch } from './ui/search.js';
import { openUpdates } from './ui/updates.js';
import { openSettings } from './ui/settings.js';
