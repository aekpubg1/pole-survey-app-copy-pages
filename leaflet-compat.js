/*
 * Leaflet adapter for the existing pole-survey UI.
 * Provides the small subset of the Google Maps JS API used by index.html,
 * while all map rendering/tiles are Leaflet + OpenStreetMap.
 */
(function (global) {
  'use strict';
  if (!global.L) throw new Error('Leaflet library is not loaded');

  var google = global.google = global.google || {};
  var maps = google.maps = google.maps || {};
  var eventStore = new WeakMap();

  function num(v, fallback) { var n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function latOf(p) { if (p && typeof p.lat === 'function') return Number(p.lat()); return Number(p && (p.lat !== undefined ? p.lat : p.latitude)); }
  function lngOf(p) { if (p && typeof p.lng === 'function') return Number(p.lng()); if (p && typeof p.lon === 'function') return Number(p.lon()); return Number(p && (p.lng !== undefined ? p.lng : (p.lon !== undefined ? p.lon : p.longitude))); }
  function latLng(p, lng) {
    if (arguments.length > 1) return new LatLng(p, lng);
    if (Array.isArray(p)) return new LatLng(p[0], p[1]);
    if (p && typeof p.lat === 'function' && typeof p.lng === 'function') return p;
    return new LatLng(latOf(p), lngOf(p));
  }
  function literal(p) { var ll = latLng(p); return { lat: ll.lat(), lng: ll.lng() }; }
  function leafLatLng(p) { var ll = latLng(p); return L.latLng(ll.lat(), ll.lng()); }
  function finiteLL(p) { var ll = latLng(p); return Number.isFinite(ll.lat()) && Number.isFinite(ll.lng()); }
  function escHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function addGenericListener(target, name, fn) {
    if (!target || typeof fn !== 'function') return { remove: function () {} };
    var ev = eventStore.get(target);
    if (!ev) { ev = Object.create(null); eventStore.set(target, ev); }
    (ev[name] || (ev[name] = [])).push(fn);
    var active = true;
    return { remove: function () { if (!active) return; active = false; var a = ev[name] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } };
  }
  function eventApi(target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return { addListener: function () { return { remove: function () {} }; }, fire: function () {} };
    var ev = eventStore.get(target);
    if (!ev) { ev = Object.create(null); eventStore.set(target, ev); }
    if (typeof target.addListener !== 'function') target.addListener = function (name, fn) { return addGenericListener(target, name, fn); };
    target.__gmFire = function (name) {
      var args = Array.prototype.slice.call(arguments, 1), listeners = (eventStore.get(target) || Object.create(null))[name];
      if (listeners) listeners.slice().forEach(function (fn) { try { fn.apply(target, args); } catch (e) { setTimeout(function () { throw e; }, 0); } });
    };
    return target;
  }
  function fire(target, name) {
    var args = Array.prototype.slice.call(arguments, 2);
    if (target && typeof target.__gmFire === 'function') target.__gmFire.apply(target, [name].concat(args));
  }
  function eventForLeaflet(e) {
    var out = { originalEvent: e && e.originalEvent, domEvent: e && e.originalEvent, target: e && e.target };
    if (e && e.latlng) out.latLng = latLng(e.latlng);
    else if (e && e.vertex && e.vertex.latlng) out.latLng = latLng(e.vertex.latlng);
    if (e && e.layerPoint) out.pixel = new Point(e.layerPoint.x, e.layerPoint.y);
    return out;
  }

  function LatLng(lat, lng) {
    if (lat && typeof lat === 'object' && arguments.length === 1) { lng = lngOf(lat); lat = latOf(lat); }
    this._lat = num(lat, NaN); this._lng = num(lng, NaN);
  }
  LatLng.prototype.lat = function () { return this._lat; };
  LatLng.prototype.lng = function () { return this._lng; };
  LatLng.prototype.toJSON = function () { return { lat: this._lat, lng: this._lng }; };
  LatLng.prototype.toString = function () { return this._lat + ',' + this._lng; };

  function Point(x, y) { this.x = num(x, 0); this.y = num(y, 0); }

  function LatLngBounds(sw, ne) {
    this._south = Infinity; this._west = Infinity; this._north = -Infinity; this._east = -Infinity;
    if (sw) this.extend(sw);
    if (ne) this.extend(ne);
  }
  LatLngBounds.prototype.extend = function (p) {
    var ll = latLng(p), a = ll.lat(), b = ll.lng();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return this;
    this._south = Math.min(this._south, a); this._north = Math.max(this._north, a);
    this._west = Math.min(this._west, b); this._east = Math.max(this._east, b);
    return this;
  };
  LatLngBounds.prototype.getSouthWest = function () { return new LatLng(this._south, this._west); };
  LatLngBounds.prototype.getNorthEast = function () { return new LatLng(this._north, this._east); };
  LatLngBounds.prototype.getCenter = function () { return new LatLng((this._south + this._north) / 2, (this._west + this._east) / 2); };
  LatLngBounds.prototype.isEmpty = function () { return !Number.isFinite(this._south) || !Number.isFinite(this._west); };
  LatLngBounds.prototype.contains = function (p) { var ll = latLng(p); return !this.isEmpty() && ll.lat() >= this._south && ll.lat() <= this._north && ll.lng() >= this._west && ll.lng() <= this._east; };
  LatLngBounds.prototype.toLeaflet = function () { return this.isEmpty() ? null : L.latLngBounds([[this._south, this._west], [this._north, this._east]]); };

  function toArrayLatLngs(path) {
    if (path instanceof MVCArray) return path.getArray().map(latLng).filter(finiteLL);
    if (!Array.isArray(path)) return [];
    return path.map(function (p) { return latLng(p); }).filter(finiteLL);
  }

  function MVCArray(values) {
    eventApi(this);
    this._values = toArrayLatLngs(values || []);
    this._owner = null;
  }
  MVCArray.prototype.getLength = function () { return this._values.length; };
  MVCArray.prototype.getAt = function (i) { return this._values[i]; };
  MVCArray.prototype.getArray = function () { return this._values.slice(); };
  MVCArray.prototype.forEach = function (fn, ctx) { this._values.forEach(fn, ctx); };
  MVCArray.prototype.push = function () {
    var values = Array.prototype.slice.call(arguments), self = this;
    values.forEach(function (v) { self._values.push(latLng(v)); fire(self, 'insert_at', self._values.length - 1); });
    this._changed(); return this._values.length;
  };
  MVCArray.prototype.pop = function () {
    if (!this._values.length) return undefined;
    var i = this._values.length - 1, v = this._values.pop(); fire(this, 'remove_at', i, v); this._changed(); return v;
  };
  MVCArray.prototype.setAt = function (i, v) {
    var old = this._values[i]; this._values[i] = latLng(v); fire(this, 'set_at', i, old); this._changed(); return old;
  };
  MVCArray.prototype.insertAt = function (i, v) { this._values.splice(i, 0, latLng(v)); fire(this, 'insert_at', i); this._changed(); };
  MVCArray.prototype.removeAt = function (i) { var old = this._values.splice(i, 1)[0]; fire(this, 'remove_at', i, old); this._changed(); return old; };
  MVCArray.prototype.clear = function () { while (this._values.length) this.pop(); };
  MVCArray.prototype._changed = function () { if (this._owner && typeof this._owner._syncLayer === 'function') this._owner._syncLayer(); };
  MVCArray.prototype._replaceFromLeaflet = function (values) {
    var next = toArrayLatLngs(values), oldLen = this._values.length, newLen = next.length, i;
    if (newLen < oldLen) {
      for (i = oldLen - 1; i >= newLen; i--) { var gone = this._values.splice(i, 1)[0]; fire(this, 'remove_at', i, gone); }
    }
    for (i = 0; i < Math.min(oldLen, newLen); i++) {
      if (Math.abs(this._values[i].lat() - next[i].lat()) > 1e-9 || Math.abs(this._values[i].lng() - next[i].lng()) > 1e-9) {
        this._values[i] = next[i]; fire(this, 'set_at', i, undefined);
      }
    }
    for (i = oldLen; i < newLen; i++) { this._values.push(next[i]); fire(this, 'insert_at', i); }
  };

  function wrapBounds(value) {
    if (value instanceof LatLngBounds) return value;
    if (value && typeof value.getSouthWest === 'function' && typeof value.getNorthEast === 'function') {
      return new LatLngBounds(value.getSouthWest(), value.getNorthEast());
    }
    if (Array.isArray(value) && value.length >= 2) return new LatLngBounds(value[0], value[1]);
    return new LatLngBounds();
  }
  function eventWrapper(fn) { return function (e) { fn.call(this, eventForLeaflet(e)); }; }
  function Map(container, options) {
    options = options || {};
    var center = options.center || { lat: 13.1119, lng: 99.9390 };
    var map = L.map(container, {
      center: [latOf(center), lngOf(center)], zoom: num(options.zoom, 17),
      zoomControl: options.zoomControl !== false, attributionControl: true,
      scrollWheelZoom: true, doubleClickZoom: true, dragging: true,
      tap: true, preferCanvas: false, zoomAnimation: true, markerZoomAnimation: true,
      editable: !!options.editable
    });
    map._gmEvents = true;
    global.__poleLeafletMap = map;
    eventApi(map);
    map.getDiv = function () { return map.getContainer(); };
    // Keep Leaflet's native getCenter() and getBounds() methods intact.
    // Leaflet internals expect L.LatLng objects with numeric .lat/.lng fields;
    // the old Google Maps-style wrappers returned .lat()/.lng() functions and
    // caused "Invalid LatLng object" while the tile layer initialized.
    map.getZoom = function () { return L.Map.prototype.getZoom.call(map); };
    map.setCenter = function (p) { var ll = latLng(p); L.Map.prototype.setView.call(map, [ll.lat(), ll.lng()], map.getZoom(), { animate: false }); };
    map.panTo = function (p) { var ll = latLng(p); L.Map.prototype.panTo.call(map, [ll.lat(), ll.lng()], { animate: false }); };
    map.setZoom = function (z) { L.Map.prototype.setZoom.call(map, num(z, map.getZoom()), { animate: false }); };
    map.fitBounds = function (b, padding) {
      var bounds = wrapBounds(b).toLeaflet();
      if (!bounds || !bounds.isValid()) return;
      var p = num(padding, 0); p = Math.max(0, Math.min(200, p));
      L.Map.prototype.fitBounds.call(map, bounds, { padding: [p, p], maxZoom: 19, animate: false });
    };
    map.setMapTypeId = function () { /* OpenStreetMap base layer only; no satellite imagery in this app. */ };
    map.setOptions = function (opts) {
      if (!opts) return;
      if (opts.zoomControl !== undefined) {
        var has = !!map.zoomControl;
        if (opts.zoomControl && !has) { map.zoomControl = L.control.zoom().addTo(map); }
        if (!opts.zoomControl && has) { map.removeControl(map.zoomControl); map.zoomControl = null; }
      }
      if (opts.zoomControlOptions && map.zoomControl && map.zoomControl.setPosition) {
        var pos = opts.zoomControlOptions.position;
        if (pos === maps.ControlPosition.RIGHT_BOTTOM) map.zoomControl.setPosition('bottomright');
        else if (pos === maps.ControlPosition.LEFT_TOP) map.zoomControl.setPosition('topleft');
      }
    };
    map.addListener = function (name, fn) {
      var cb = eventWrapper(fn); map.on(name, cb);
      return { remove: function () { map.off(name, cb); } };
    };
    map.setMapTypeId('roadmap');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 3, maxZoom: 19, maxNativeZoom: 19, updateWhenIdle: true, keepBuffer: 2,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
    }).addTo(map);
    map.on('move zoom resize viewreset', function () { map.fire('idle'); });
    return map;
  }
  function LatLngBoundsFromLeaflet(b) {
    var sw = b.getSouthWest(), ne = b.getNorthEast();
    return new LatLngBounds(sw, ne);
  }

  function OverlayView() { this._gmMap = null; this._leafletLayer = null; this._leafletMap = null; }
  OverlayView.prototype.setMap = function (map) {
    if (this._gmMap === map) return;
    if (this._gmMap && this._leafletLayer) this._gmMap.removeLayer(this._leafletLayer);
    this._gmMap = map || null;
    if (!map) { this._leafletLayer = null; this._leafletMap = null; return; }
    var self = this, layer = L.layerGroup();
    layer.onAdd = function (leafletMap) {
      this._map = leafletMap; self._leafletMap = leafletMap;
      self.onAdd();
      this._refresh = function () { if (self.draw) self.draw(); };
      leafletMap.on('move zoom resize viewreset', this._refresh);
      if (self.draw) self.draw();
    };
    layer.onRemove = function (leafletMap) {
      leafletMap.off('move zoom resize viewreset', this._refresh);
      if (self.onRemove) self.onRemove();
      self._leafletMap = null; this._map = null;
    };
    this._leafletLayer = layer; map.addLayer(layer);
  };
  OverlayView.prototype.getPanes = function () {
    var m = this._leafletMap;
    if (!m) return null;
    var p = m.getPanes(); return { overlayLayer: p.overlayPane, overlayMouseTarget: p.markerPane, floatPane: p.popupPane };
  };
  OverlayView.prototype.getProjection = function () {
    var m = this._leafletMap;
    if (!m) return null;
    return {
      fromLatLngToDivPixel: function (p) { var q = m.latLngToLayerPoint(leafLatLng(p)); return new Point(q.x, q.y); },
      fromDivPixelToLatLng: function (p) { var q = m.layerPointToLatLng([p.x, p.y]); return new LatLng(q.lat, q.lng); },
      fromLatLngToContainerPixel: function (p) { var q = m.latLngToContainerPoint(leafLatLng(p)); return new Point(q.x, q.y); },
      fromContainerPixelToLatLng: function (p) { var q = m.containerPointToLatLng([p.x, p.y]); return new LatLng(q.lat, q.lng); }
    };
  };
  OverlayView.prototype.getMap = function () { return this._gmMap; };
  OverlayView.prototype.draw = function () {};
  OverlayView.prototype.onAdd = function () {};
  OverlayView.prototype.onRemove = function () {};

  function getStyleOptions(opts) {
    opts = opts || {};
    var style = {
      color: opts.strokeColor || '#3388ff', opacity: num(opts.strokeOpacity, 1),
      weight: num(opts.strokeWeight, 3), fillColor: opts.fillColor || opts.strokeColor || '#3388ff',
      fillOpacity: num(opts.fillOpacity, 0.2), interactive: opts.clickable !== false,
      bubblingMouseEvents: false
    };
    if (opts.icons && opts.icons.length) style.dashArray = '6 8';
    if (opts.zIndex !== undefined) style.pane = 'overlayPane';
    return style;
  }
  function layerLatLngs(arr) { return (arr || []).map(function (p) { return [latLng(p).lat(), latLng(p).lng()]; }); }
  function Shape(opts, polygon) {
    opts = opts || {}; this.options = Object.assign({}, opts); this._map = null; this._layer = null; this._polygon = !!polygon;
    eventApi(this);
    var initial = polygon ? (opts.paths || []) : (opts.path || []);
    if (polygon && Array.isArray(initial) && initial.length && (initial[0] instanceof MVCArray || Array.isArray(initial[0]) && !(typeof initial[0][0] === 'number'))) initial = initial[0];
    this._path = initial instanceof MVCArray ? initial : new MVCArray(initial);
    this._path._owner = this;
    this._layer = polygon ? L.polygon(layerLatLngs(this._path._values), getStyleOptions(opts)) : L.polyline(layerLatLngs(this._path._values), getStyleOptions(opts));
    var self = this;
    this._layer.on('click', function (e) { fire(self, 'click', eventForLeaflet(e)); });
    this._layer.on('editable:vertex:dragend editable:vertex:new editable:vertex:deleted', function () { self._syncFromLeaflet(); });
    this._mapEditSync = function (e) {
      if (!self._map || !self._layer) return;
      var editedLayer = e && (e.layer || (e.vertex && e.vertex.editor && e.vertex.editor.feature));
      if (!editedLayer || editedLayer === self._layer) self._syncFromLeaflet();
    };
    if (opts.map) this.setMap(opts.map);
    if (opts.editable) this._enableEdit();
  }
  Shape.prototype.addListener = function (name, fn) {
    var self = this;
    if (name === 'dragend' && this._map) {
      var map = this._map;
      var editCb = function (e) {
        var editedLayer = e && (e.layer || (e.vertex && e.vertex.editor && e.vertex.editor.feature));
        if (!editedLayer || editedLayer === self._layer) fn.call(self, eventForLeaflet(e));
      };
      map.on('editable:vertex:dragend', editCb);
      return { remove: function () { map.off('editable:vertex:dragend', editCb); } };
    }
    if (this._layer && (name === 'click' || name === 'mouseover' || name === 'mouseout' || name === 'mousedown' || name === 'mouseup')) {
      var cb = function (e) { fn.call(self, eventForLeaflet(e)); }; this._layer.on(name, cb);
      return { remove: function () { self._layer && self._layer.off(name, cb); } };
    }
    return addGenericListener(this, name, fn);
  };
  Shape.prototype.setMap = function (map) {
    if (this._map === map) return;
    if (this._map && this._mapEditSync) this._map.off('editable:vertex:dragend editable:vertex:new editable:vertex:deleted', this._mapEditSync);
    if (this._map && this._layer) this._map.removeLayer(this._layer);
    this._map = map || null;
    if (map && this._layer) {
      map.addLayer(this._layer);
      if (this.options.editable) this._enableEdit();
      map.on('editable:vertex:dragend editable:vertex:new editable:vertex:deleted', this._mapEditSync);
    }
  };
  Shape.prototype.getMap = function () { return this._map; };
  Shape.prototype.getPath = function () { return this._path; };
  Shape.prototype.getPaths = function () { return new MVCArray([this._path]); };
  Shape.prototype.setPath = function (p) { this._path._values = toArrayLatLngs(p); this._syncLayer(); };
  Shape.prototype.setOptions = function (o) {
    o = o || {}; Object.assign(this.options, o);
    if (this._layer && this._layer.setStyle) this._layer.setStyle(getStyleOptions(this.options));
    if (o.path !== undefined) this.setPath(o.path);
    if (o.paths !== undefined) this.setPath(Array.isArray(o.paths) && o.paths.length ? o.paths[0] : []);
    if (o.editable === true) this._enableEdit();
    if (o.editable === false && this._layer && this._layer.disableEdit) this._layer.disableEdit();
    return this;
  };
  Shape.prototype._syncLayer = function () {
    if (!this._layer) return;
    this._layer.setLatLngs(layerLatLngs(this._path._values));
    if (this._layer.redraw) this._layer.redraw();
    if (this.options.editable) {
      this._enableEdit();
      if (this._layer.editor && typeof this._layer.editor.reset === 'function') {
        try { this._layer.editor.reset(); } catch (_) {}
      }
    }
  };
  Shape.prototype._syncFromLeaflet = function () {
    if (!this._layer || !this._layer.getLatLngs) return;
    var values = this._layer.getLatLngs();
    if (this._polygon && Array.isArray(values) && values.length && Array.isArray(values[0])) values = values[0];
    this._path._replaceFromLeaflet(values);
  };
  Shape.prototype._enableEdit = function () {
    if (this._layer && typeof this._layer.enableEdit === 'function' && this._map) {
      try { this._layer.enableEdit(this._map); } catch (e) { console.warn('[Leaflet editable]', e); }
    }
  };
  Shape.prototype.setVisible = function (visible) { if (visible) this.setMap(this._map || global.__poleLeafletMap); else this.setMap(null); };
  function Polyline(opts) { return new Shape(opts || {}, false); }
  function Polygon(opts) { return new Shape(opts || {}, true); }

  function markerDivIcon(opts) {
    opts = opts || {};
    var icon = opts.icon || null, label = opts.label || null;
    var circle = icon && (icon.path === maps.SymbolPath.CIRCLE || icon.path === 'CIRCLE');
    if (!circle && !label) {
      return L.divIcon({ className: 'gm-lite-marker-wrap', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [10, 20] });
    }
    var scale = circle ? Math.max(4, num(icon.scale, 7)) : 11;
    var sw = circle ? Math.max(1, num(icon.strokeWeight, 2)) : 2;
    var size = Math.max(16, Math.ceil(scale * 2 + sw * 2 + 2));
    var fill = circle ? (icon.fillColor || '#d32f2f') : '#d32f2f';
    var stroke = circle ? (icon.strokeColor || '#fff') : '#fff';
    var opacity = circle ? Math.max(0, Math.min(1, num(icon.fillOpacity, 1))) : 1;
    var txt = label && label.text != null ? String(label.text) : '';
    var color = label && label.color || '#fff';
    var fontSize = label && label.fontSize || '10px';
    var weight = label && label.fontWeight || '700';
    var html = '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;box-sizing:border-box;background:' + escHtml(fill) + ';opacity:' + opacity + ';border:' + sw + 'px solid ' + escHtml(stroke) + ';display:flex;align-items:center;justify-content:center;color:' + escHtml(color) + ';font:' + escHtml(weight + ' ' + fontSize + ' Arial,sans-serif') + ';white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35);">' + escHtml(txt) + '</div>';
    return L.divIcon({ className: 'gm-lite-marker-wrap', html: html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function Marker(opts) {
    opts = opts || {}; this.options = Object.assign({}, opts); this._map = null; this._layer = null; eventApi(this);
    var pos = opts.position || { lat: 0, lng: 0 };
    this._layer = L.marker(leafLatLng(pos), {
      icon: markerDivIcon(opts), draggable: !!opts.draggable, keyboard: false,
      title: String(opts.title || ''), zIndexOffset: num(opts.zIndex, 0), opacity: opts.visible === false ? 0 : 1,
      interactive: opts.clickable !== false, bubblingMouseEvents: false, autoPan: true
    });
    var self = this;
    this._layer.on('click', function (e) { fire(self, 'click', eventForLeaflet(e)); });
    this._layer.on('dragend', function (e) { fire(self, 'dragend', eventForLeaflet(e)); });
    this._layer.on('drag', function (e) { fire(self, 'drag', eventForLeaflet(e)); });
    if (opts.map) this.setMap(opts.map);
  }
  Marker.prototype.addListener = function (name, fn) {
    var self = this, cb = function (e) { fn.call(self, eventForLeaflet(e)); };
    if (this._layer && ['click', 'dragend', 'drag', 'mousedown', 'mouseup'].indexOf(name) >= 0) {
      this._layer.on(name, cb); return { remove: function () { self._layer && self._layer.off(name, cb); } };
    }
    return addGenericListener(this, name, fn);
  };
  Marker.prototype.setMap = function (map) {
    if (this._map === map) return;
    if (this._map && this._layer) this._map.removeLayer(this._layer);
    this._map = map || null;
    if (map && this._layer) map.addLayer(this._layer);
  };
  Marker.prototype.getMap = function () { return this._map; };
  Marker.prototype.getPosition = function () { var p = this._layer.getLatLng(); return new LatLng(p.lat, p.lng); };
  Marker.prototype.setPosition = function (p) { this._layer.setLatLng(leafLatLng(p)); };
  Marker.prototype.setTitle = function (title) { this.options.title = String(title || ''); this._layer.options.title = this.options.title; var el = this._layer.getElement(); if (el) el.title = this.options.title; };
  Marker.prototype.setDraggable = function (v) { this.options.draggable = !!v; if (this._layer.dragging) { if (v) this._layer.dragging.enable(); else this._layer.dragging.disable(); } };
  Marker.prototype.setVisible = function (v) { this.options.visible = !!v; var el = this._layer.getElement(); if (el) el.style.display = v ? '' : 'none'; };
  Marker.prototype.setIcon = function (icon) { this.options.icon = icon; this._layer.setIcon(markerDivIcon(this.options)); };
  Marker.prototype.setOptions = function (opts) {
    opts = opts || {}; Object.assign(this.options, opts);
    if (opts.position) this.setPosition(opts.position);
    if (opts.icon !== undefined || opts.label !== undefined) this._layer.setIcon(markerDivIcon(this.options));
    if (opts.title !== undefined) this.setTitle(opts.title);
    if (opts.draggable !== undefined) this.setDraggable(opts.draggable);
    if (opts.map !== undefined) this.setMap(opts.map);
    if (opts.visible !== undefined) this.setVisible(opts.visible);
    if (opts.zIndex !== undefined) this._layer.setZIndexOffset(num(opts.zIndex, 0));
    if (opts.clickable !== undefined) { this._layer.options.interactive = !!opts.clickable; var el = this._layer.getElement(); if (el) el.style.pointerEvents = opts.clickable ? '' : 'none'; }
  };

  function Circle(opts) {
    opts = opts || {}; this.options = Object.assign({}, opts); this._map = null; eventApi(this);
    this._layer = L.circle(leafLatLng(opts.center || { lat: 0, lng: 0 }), Object.assign(getStyleOptions(opts), { radius: num(opts.radius, 0) }));
    var self = this; this._layer.on('click', function (e) { fire(self, 'click', eventForLeaflet(e)); });
    if (opts.map) this.setMap(opts.map);
  }
  Circle.prototype.setMap = function (map) { if (this._map === map) return; if (this._map) this._map.removeLayer(this._layer); this._map = map || null; if (map) map.addLayer(this._layer); };
  Circle.prototype.getMap = function () { return this._map; };
  Circle.prototype.setCenter = function (p) { this._layer.setLatLng(leafLatLng(p)); };
  Circle.prototype.getCenter = function () { var p = this._layer.getLatLng(); return new LatLng(p.lat, p.lng); };
  Circle.prototype.setRadius = function (r) { this._layer.setRadius(Math.max(0, num(r, 0))); };
  Circle.prototype.getRadius = function () { return this._layer.getRadius(); };
  Circle.prototype.setOptions = function (opts) { opts = opts || {}; Object.assign(this.options, opts); if (opts.center) this.setCenter(opts.center); if (opts.radius !== undefined) this.setRadius(opts.radius); this._layer.setStyle(getStyleOptions(this.options)); if (opts.map !== undefined) this.setMap(opts.map); };
  Circle.prototype.addListener = function (name, fn) { var self = this, cb = function (e) { fn.call(self, eventForLeaflet(e)); }; this._layer.on(name, cb); return { remove: function () { self._layer.off(name, cb); } }; };

  function InfoWindow(opts) { this.options = opts || {}; this._content = ''; this._position = null; this._popup = L.popup({ closeButton: true, autoPan: true, maxWidth: 280, minWidth: 130, className: 'pole-info-popup' }); }
  InfoWindow.prototype.setContent = function (content) { this._content = content == null ? '' : content; this._popup.setContent(this._content); };
  InfoWindow.prototype.setPosition = function (pos) { this._position = latLng(pos); this._popup.setLatLng(leafLatLng(this._position)); };
  InfoWindow.prototype.open = function (mapOrOptions, anchor) {
    var map = mapOrOptions && mapOrOptions.map ? mapOrOptions.map : mapOrOptions;
    var a = (mapOrOptions && mapOrOptions.anchor) || anchor;
    if (a && typeof a.getPosition === 'function') this.setPosition(a.getPosition());
    if (!this._position && a && a._layer && a._layer.getLatLng) this.setPosition(a._layer.getLatLng());
    if (!this._position || !map) return;
    this._popup.setLatLng(leafLatLng(this._position)).setContent(this._content).openOn(map);
  };
  InfoWindow.prototype.close = function () { if (this._popup && this._popup._map) this._popup._map.closePopup(this._popup); };

  maps.Map = Map; maps.LatLng = LatLng; maps.Point = Point; maps.LatLngBounds = LatLngBounds;
  maps.MVCArray = MVCArray; maps.OverlayView = OverlayView; maps.Marker = Marker;
  maps.Polyline = Polyline; maps.Polygon = Polygon; maps.Circle = Circle; maps.InfoWindow = InfoWindow;
  maps.SymbolPath = maps.SymbolPath || { CIRCLE: 'CIRCLE' };
  maps.ControlPosition = maps.ControlPosition || { LEFT_TOP: 1, RIGHT_BOTTOM: 2, LEFT_CENTER: 3 };
  maps.MapTypeId = maps.MapTypeId || { ROADMAP: 'roadmap' };
  maps.event = maps.event || {};
  maps.event.addListener = function (target, name, fn) {
    if (target && typeof target.addListener === 'function') return target.addListener(name, fn);
    return eventApi(target).addListener(name, fn);
  };
  maps.event.removeListener = function (handle) { if (handle && typeof handle.remove === 'function') handle.remove(); };
  maps.event.trigger = function (target, name) {
    var args = Array.prototype.slice.call(arguments, 2);
    if (target && typeof target.invalidateSize === 'function' && name === 'resize') { target.invalidateSize({ pan: false }); return; }
    fire.apply(null, [target, name].concat(args));
    if (target && typeof target.fire === 'function') target.fire(name, args[0]);
  };

  var style = document.createElement('style');
  style.textContent = [
    '.leaflet-container{font-family:"Noto Sans Thai",system-ui,sans-serif;background:#e8e4f2;outline:0}',
    '.leaflet-control-attribution{font-size:10px!important;line-height:1.25!important;background:rgba(255,255,255,.86)!important;margin:0!important;padding:2px 5px!important;max-width:75vw}',
    '.leaflet-control-zoom a{color:#34235f!important}',
    '.gm-lite-marker-wrap{background:transparent!important;border:0!important}',
    '.gm-lite-marker-wrap .pin{width:22px;height:22px;box-sizing:border-box}',
    '.pole-info-popup .leaflet-popup-content-wrapper{border-radius:10px}',
    '.pole-info-popup .leaflet-popup-content{margin:10px 12px;line-height:1.4}',
    '.leaflet-editing-icon{border:2px solid #fff!important;box-shadow:0 1px 5px #333!important;background:#d81b60!important}',
    '.leaflet-marker-icon{touch-action:manipulation}'
  ].join('\n');
  document.head.appendChild(style);

  global.PoleSurveyMap = { provider: 'OpenStreetMap', library: 'Leaflet', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' };
})(window);
