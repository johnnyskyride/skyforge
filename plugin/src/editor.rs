use crate::{FaceBus, FilterKind, Kind, SkyForgeParams, WaveKind};
use nih_plug::prelude::*;
use nih_plug_egui::{
    create_egui_editor,
    egui::{
        self, epaint::PathShape, Color32, CornerRadius, FontId, Pos2, Rect, Sense, Stroke,
        StrokeKind, Ui, Vec2,
    },
    EguiState,
};
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub const FACE_W: u32 = 1048;
pub const FACE_H: u32 = 668;

const LIVE_BG: Color32 = Color32::from_rgb(0x4a, 0x3a, 0x62);
const CHASSIS: Color32 = Color32::from_rgb(0x22, 0x1c, 0x2e);
const CHASSIS_TOP: Color32 = Color32::from_rgb(0x2e, 0x27, 0x3c);
const PANEL: Color32 = Color32::from_rgb(0x2c, 0x25, 0x3a);
const WELL: Color32 = Color32::from_rgb(0x14, 0x10, 0x1c);
const FG: Color32 = Color32::from_rgb(0xec, 0xe8, 0xf0);
const MUTED: Color32 = Color32::from_rgb(0x9b, 0x93, 0xab);
const EMERALD: Color32 = Color32::from_rgb(0x12, 0xe0, 0x8a);
const PEARL: Color32 = Color32::from_rgb(0xd9, 0xb8, 0xff);
const GHOST: Color32 = Color32::from_rgb(0xf4, 0xef, 0xe6);
const TIDE: Color32 = Color32::from_rgb(0x5e, 0xd4, 0xd0);
const AETHER: Color32 = Color32::from_rgb(0xc0, 0x70, 0xff);
const HAUNT: Color32 = Color32::from_rgb(0xd4, 0x78, 0x3a);
const KEY_W: Color32 = Color32::from_rgb(0xe6, 0xe2, 0xd8);
const KEY_B: Color32 = Color32::from_rgb(0x16, 0x17, 0x1c);

#[derive(Clone, Copy, PartialEq)]
enum Trim {
    Off,
    Plasma,
    Purple,
    Green,
}

struct UiMem {
    trim: Trim,
    held_key: Option<u8>,
}

pub fn build_editor(params: Arc<SkyForgeParams>, bus: Arc<FaceBus>) -> Option<Box<dyn Editor>> {
    let state = params.editor_state.clone();
    create_egui_editor(
        state,
        UiMem {
            trim: Trim::Plasma,
            held_key: None,
        },
        |ctx, _| {
            let mut visuals = egui::Visuals::dark();
            visuals.panel_fill = LIVE_BG;
            visuals.window_fill = LIVE_BG;
            visuals.override_text_color = Some(FG);
            ctx.set_visuals(visuals);
        },
        move |ctx, setter, mem| {
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE.fill(LIVE_BG))
                .show(ctx, |ui| {
                    paint_face(ui, setter, &params, &bus, mem);
                });
            ctx.request_repaint();
        },
    )
}

fn paint_face(
    ui: &mut Ui,
    setter: &ParamSetter,
    params: &SkyForgeParams,
    bus: &FaceBus,
    mem: &mut UiMem,
) {
    let rms = f32::from_bits(bus.rms.load(Ordering::Relaxed)).clamp(0.0, 1.0);
    let full = ui.max_rect();
    let halo = 22.0;
    let chassis = full.shrink(halo);
    let rounding = CornerRadius::same(16);

    let trim_color = match mem.trim {
        Trim::Off => Color32::TRANSPARENT,
        Trim::Purple => Color32::from_rgb(0xc0, 0x70, 0xff),
        Trim::Green => Color32::from_rgb(0x3d, 0xff, 0x9a),
        Trim::Plasma => {
            let t = ui.input(|i| i.time) * 0.22;
            hsv(t.fract() as f32, 0.72, 1.0)
        }
    };
    if mem.trim != Trim::Off {
        let g = 0.28 + rms * 0.72;
        for (spread, alpha) in [(8.0, 0.55), (22.0, 0.32), (48.0, 0.18), (78.0, 0.10)] {
            let a = (g * alpha * 255.0) as u8;
            ui.painter().rect_stroke(
                chassis.expand(spread * 0.15),
                CornerRadius::same((16.0 + spread * 0.08).clamp(1.0, 40.0) as u8),
                Stroke::new(
                    spread * 0.45,
                    Color32::from_rgba_unmultiplied(
                        trim_color.r(),
                        trim_color.g(),
                        trim_color.b(),
                        a,
                    ),
                ),
                StrokeKind::Outside,
            );
        }
        ui.painter().rect_stroke(
            chassis.expand(1.5),
            rounding,
            Stroke::new(
                1.6,
                Color32::from_rgba_unmultiplied(
                    trim_color.r(),
                    trim_color.g(),
                    trim_color.b(),
                    (90.0 + rms * 140.0) as u8,
                ),
            ),
            StrokeKind::Outside,
        );
    }

    ui.painter().rect_filled(chassis, rounding, CHASSIS);
    ui.painter().rect_filled(
        Rect::from_min_size(chassis.min, Vec2::new(chassis.width(), 54.0)),
        CornerRadius {
            nw: 16,
            ne: 16,
            sw: 0,
            se: 0,
        },
        CHASSIS_TOP,
    );
    ui.painter().rect_stroke(
        chassis,
        rounding,
        Stroke::new(1.0, Color32::from_rgb(0x52, 0x4a, 0x62)),
        StrokeKind::Inside,
    );

    let mut y = chassis.min.y + 10.0;
    let x = chassis.min.x + 16.0;
    let w = chassis.width() - 32.0;

    // header
    let led_r = Rect::from_min_size(Pos2::new(x, y + 4.0), Vec2::new(22.0, 22.0));
    ui.painter().circle_filled(led_r.center(), 8.0, Color32::from_rgb(0x3a, 0x2a, 0x18));
    ui.painter().circle_filled(led_r.center(), 5.5, Color32::from_rgb(0xe8, 0xc05a));
    ui.painter().text(
        Pos2::new(x + 30.0, y + 4.0),
        egui::Align2::LEFT_TOP,
        "SF-33  ·  @johnnyskyride",
        FontId::monospace(11.0),
        MUTED,
    );
    ui.painter().text(
        Pos2::new(chassis.max.x - 18.0, y + 2.0),
        egui::Align2::RIGHT_TOP,
        "SKYFORGE",
        FontId::proportional(18.0),
        FG,
    );

    // trim pads
    let mut tx = chassis.max.x - 210.0;
    for (label, mode) in [
        ("Plasma", Trim::Plasma),
        ("Purple", Trim::Purple),
        ("Green", Trim::Green),
    ] {
        let r = Rect::from_min_size(Pos2::new(tx, y + 22.0), Vec2::new(58.0, 18.0));
        let on = mem.trim == mode;
        let resp = ui.allocate_rect(r, Sense::click());
        ui.painter().rect_filled(
            r,
            CornerRadius::same(4),
            if on { PANEL } else { Color32::from_rgb(0x1a, 0x16, 0x23) },
        );
        ui.painter().text(
            r.center(),
            egui::Align2::CENTER_CENTER,
            label,
            FontId::monospace(9.0),
            if on { FG } else { MUTED },
        );
        if resp.clicked() {
            mem.trim = if on { Trim::Off } else { mode };
        }
        tx += 62.0;
    }

    y += 48.0;

    // banks
    ui.scope(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(6.0, 6.0);
        let bank = Rect::from_min_size(Pos2::new(x, y), Vec2::new(w, 34.0));
        ui.allocate_ui_at_rect(bank, |ui| {
            ui.horizontal(|ui| {
                chip_enum(ui, setter, &params.wave, WaveKind::Sine, "Sine");
                chip_enum(ui, setter, &params.wave, WaveKind::Triangle, "Tri");
                chip_enum(ui, setter, &params.wave, WaveKind::Saw, "Saw");
                chip_enum(ui, setter, &params.wave, WaveKind::Square, "Sqr");
                chip_enum(ui, setter, &params.wave, WaveKind::Pulse, "Pulse");
                chip_enum(ui, setter, &params.wave, WaveKind::Noise, "Noise");
                ui.add_space(10.0);
                chip_enum(ui, setter, &params.filter, FilterKind::Lowpass, "LP");
                chip_enum(ui, setter, &params.filter, FilterKind::Highpass, "HP");
                chip_enum(ui, setter, &params.filter, FilterKind::Bandpass, "BP");
                ui.add_space(10.0);
                chip_enum(ui, setter, &params.kind, Kind::Free, "Free");
                chip_enum(ui, setter, &params.kind, Kind::Earth, "Earth");
                chip_enum(ui, setter, &params.kind, Kind::Water, "Water");
                chip_enum(ui, setter, &params.kind, Kind::Fire, "Fire");
                chip_enum(ui, setter, &params.kind, Kind::Wind, "Wind");
            });
        });
    });
    y += 42.0;

    // screens + cutoff/reso
    let screen_h = 118.0;
    ui.allocate_ui_at_rect(
        Rect::from_min_size(Pos2::new(x, y), Vec2::new(w, screen_h)),
        |ui| {
            ui.horizontal(|ui| {
                knob(ui, setter, &params.cutoff, "Cutoff", EMERALD);
                knob(ui, setter, &params.reso, "Reso", EMERALD);
                let scope_w = 280.0;
                let call_w = 300.0;
                well(ui, scope_w, screen_h - 8.0, |ui, rect| {
                    ui.painter().text(
                        Pos2::new(rect.min.x + 8.0, rect.min.y + 4.0),
                        egui::Align2::LEFT_TOP,
                        "SCOPE",
                        FontId::monospace(9.0),
                        MUTED,
                    );
                    draw_scope(ui, rect.shrink2(Vec2::new(8.0, 16.0)), bus, PEARL);
                });
                well(ui, call_w, screen_h - 8.0, |ui, rect| {
                    ui.painter().text(
                        Pos2::new(rect.min.x + 8.0, rect.min.y + 4.0),
                        egui::Align2::LEFT_TOP,
                        "CALL",
                        FontId::monospace(9.0),
                        MUTED,
                    );
                    draw_wyrm(ui, rect.shrink2(Vec2::new(10.0, 16.0)), bus, rms, params.kind.value());
                });
            });
        },
    );
    y += screen_h + 8.0;

    // fx knobs
    ui.allocate_ui_at_rect(
        Rect::from_min_size(Pos2::new(x, y), Vec2::new(w, 86.0)),
        |ui| {
            ui.horizontal(|ui| {
                knob(ui, setter, &params.volume, "Live", PEARL);
                knob(ui, setter, &params.halloween, "Halloween", GHOST);
                knob(ui, setter, &params.waters, "Waters", TIDE);
                knob(ui, setter, &params.aether, "Aether", AETHER);
                ui.add_space(12.0);
                int_step(ui, setter, &params.unison, "Uni", 1, 3);
                int_step(ui, setter, &params.octave, "Oct", -2, 2);
            });
        },
    );
    y += 90.0;

    // envelope over keys
    ui.allocate_ui_at_rect(
        Rect::from_min_size(Pos2::new(x, y), Vec2::new(w, 86.0)),
        |ui| {
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("ENV").monospace().size(10.0).color(PEARL));
                knob(ui, setter, &params.attack, "Attack", PEARL);
                knob(ui, setter, &params.decay, "Decay", PEARL);
                knob(ui, setter, &params.sustain, "Sustain", PEARL);
                knob(ui, setter, &params.release, "Release", PEARL);
                if params.wave.value() == WaveKind::Pulse {
                    knob(ui, setter, &params.pulse_width, "Width", EMERALD);
                }
            });
        },
    );
    y += 88.0;

    let piano = Rect::from_min_max(
        Pos2::new(x, y),
        Pos2::new(chassis.max.x - 16.0, chassis.max.y - 16.0),
    );
    draw_piano(ui, bus, piano, mem);
}

fn chip_enum<T: PartialEq + Copy>(
    ui: &mut Ui,
    setter: &ParamSetter,
    param: &impl Param<Plain = T>,
    value: T,
    label: &str,
) {
    let on = param.modulated_plain_value() == value;
    let resp = ui.add_sized(
        Vec2::new(48.0, 24.0),
        egui::Button::new(egui::RichText::new(label).size(11.0).color(if on { FG } else { MUTED }))
            .fill(if on { Color32::from_rgb(0x3a, 0x32, 0x4c) } else { Color32::from_rgb(0x18, 0x14, 0x22) }),
    );
    if resp.clicked() {
        setter.begin_set_parameter(param);
        setter.set_parameter(param, value);
        setter.end_set_parameter(param);
    }
}

fn knob(ui: &mut Ui, setter: &ParamSetter, param: &FloatParam, label: &str, color: Color32) {
    ui.vertical(|ui| {
        ui.set_width(62.0);
        ui.label(egui::RichText::new(label.to_uppercase()).monospace().size(9.0).color(color));
        let (rect, resp) = ui.allocate_exact_size(Vec2::new(44.0, 44.0), Sense::click_and_drag());
        let n = param.unmodulated_normalized_value();
        if resp.drag_started() {
            setter.begin_set_parameter(param);
        }
        if resp.dragged() {
            let next = (n - resp.drag_delta().y * 0.006).clamp(0.0, 1.0);
            setter.set_parameter_normalized(param, next);
        }
        if resp.drag_stopped() {
            setter.end_set_parameter(param);
        }
        if resp.double_clicked() {
            setter.begin_set_parameter(param);
            setter.set_parameter_normalized(param, param.default_normalized_value());
            setter.end_set_parameter(param);
        }
        let c = rect.center();
        ui.painter().circle_filled(c, 20.0, Color32::from_rgb(0x1a, 0x16, 0x22));
        ui.painter().circle_stroke(c, 20.0, Stroke::new(2.0, color));
        let ang = -2.356 + n * 4.712; // -135° .. +135°
        let p = Pos2::new(c.x + ang.cos() * 14.0, c.y + ang.sin() * 14.0);
        ui.painter().line_segment([c, p], Stroke::new(2.2, color));
        ui.label(
            egui::RichText::new(param.to_string())
                .monospace()
                .size(9.0)
                .color(MUTED),
        );
    });
}

fn int_step(ui: &mut Ui, setter: &ParamSetter, param: &IntParam, label: &str, min: i32, max: i32) {
    ui.vertical(|ui| {
        ui.set_width(52.0);
        ui.label(egui::RichText::new(label.to_uppercase()).monospace().size(9.0).color(MUTED));
        ui.horizontal(|ui| {
            if ui.button("−").clicked() {
                let v = (param.value() - 1).clamp(min, max);
                setter.begin_set_parameter(param);
                setter.set_parameter(param, v);
                setter.end_set_parameter(param);
            }
            ui.label(egui::RichText::new(format!("{}", param.value())).monospace().size(14.0));
            if ui.button("+").clicked() {
                let v = (param.value() + 1).clamp(min, max);
                setter.begin_set_parameter(param);
                setter.set_parameter(param, v);
                setter.end_set_parameter(param);
            }
        });
    });
}

fn well(ui: &mut Ui, w: f32, h: f32, add: impl FnOnce(&mut Ui, Rect)) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(w, h), Sense::hover());
    ui.painter().rect_filled(rect, CornerRadius::same(8), WELL);
    ui.painter().rect_stroke(
        rect,
        CornerRadius::same(8),
        Stroke::new(1.0, Color32::from_rgb(0x3d, 0x36, 0x50)),
        StrokeKind::Inside,
    );
    add(ui, rect);
}

fn draw_scope(ui: &mut Ui, rect: Rect, bus: &FaceBus, color: Color32) {
    let data = bus.scope.lock().unwrap_or_else(|e| e.into_inner());
    let n = data.len();
    if n < 2 || rect.width() < 4.0 {
        return;
    }
    let mut pts = Vec::with_capacity(n);
    for (i, s) in data.iter().enumerate() {
        let x = rect.min.x + (i as f32 / (n - 1) as f32) * rect.width();
        let y = rect.center().y - s.clamp(-1.0, 1.0) * rect.height() * 0.42;
        pts.push(Pos2::new(x, y));
    }
    ui.painter().add(PathShape::line(pts, Stroke::new(1.4, color)));
}

fn draw_wyrm(ui: &mut Ui, rect: Rect, bus: &FaceBus, rms: f32, kind: Kind) {
    let data = bus.scope.lock().unwrap_or_else(|e| e.into_inner());
    let color = match kind {
        Kind::Earth => EMERALD,
        Kind::Water => TIDE,
        Kind::Fire => HAUNT,
        Kind::Wind => Color32::from_rgb(0xc8, 0xdc, 0xff),
        Kind::Free => PEARL,
    };
    let n = data.len().max(2);
    let mut pts = Vec::with_capacity(n);
    let t = ui.input(|i| i.time) as f32;
    for (i, s) in data.iter().enumerate() {
        let u = i as f32 / (n - 1) as f32;
        let x = rect.min.x + u * rect.width();
        let wiggle = (u * 6.283 + t * (0.8 + rms * 3.2)).sin() * (4.0 + rms * 10.0);
        let y = rect.center().y - s.clamp(-1.0, 1.0) * rect.height() * 0.28 - wiggle * 0.35;
        pts.push(Pos2::new(x, y));
    }
    ui.painter().add(PathShape::line(
        pts,
        Stroke::new(2.4 + rms * 2.0, color),
    ));
}

fn draw_piano(ui: &mut Ui, bus: &FaceBus, rect: Rect, mem: &mut UiMem) {
    let held = bus.held.lock().unwrap_or_else(|e| e.into_inner());
    let base = 48u8;
    let whites: Vec<u8> = (0..25)
        .map(|i| base + i)
        .filter(|m| !is_black(*m))
        .collect();
    let nw = whites.len().max(1) as f32;
    let ww = rect.width() / nw;
    let pointer_down = ui.input(|i| i.pointer.primary_down());
    if !pointer_down {
        if let Some(m) = mem.held_key.take() {
            if let Ok(mut inbox) = bus.inbox.lock() {
                inbox.push((m, false, 0.0));
            }
        }
    }

    let mut hit: Option<u8> = None;
    for (i, midi) in whites.iter().enumerate() {
        let r = Rect::from_min_size(
            Pos2::new(rect.min.x + i as f32 * ww, rect.min.y),
            Vec2::new(ww - 1.5, rect.height()),
        );
        let on = held.get(*midi as usize).copied().unwrap_or(false);
        let resp = ui.allocate_rect(r, Sense::click_and_drag());
        ui.painter().rect_filled(
            r,
            CornerRadius {
                nw: 0,
                ne: 0,
                sw: 3,
                se: 3,
            },
            if on { PEARL } else { KEY_W },
        );
        if resp.is_pointer_button_down_on() {
            hit = Some(*midi);
        }
    }
    for midi in (base..base + 25).filter(|m| is_black(*m)) {
        let whites_before = (base..midi).filter(|m| !is_black(*m)).count() as f32;
        let r = Rect::from_min_size(
            Pos2::new(rect.min.x + whites_before * ww - ww * 0.32, rect.min.y),
            Vec2::new(ww * 0.62, rect.height() * 0.62),
        );
        let on = held.get(midi as usize).copied().unwrap_or(false);
        let resp = ui.allocate_rect(r, Sense::click_and_drag());
        ui.painter().rect_filled(r, CornerRadius::same(2), if on { PEARL } else { KEY_B });
        if resp.is_pointer_button_down_on() {
            hit = Some(midi);
        }
    }
    drop(held);
    if let Some(m) = hit {
        if mem.held_key != Some(m) {
            if let Ok(mut inbox) = bus.inbox.lock() {
                if let Some(old) = mem.held_key {
                    inbox.push((old, false, 0.0));
                }
                inbox.push((m, true, 0.9));
            }
            mem.held_key = Some(m);
        }
    }
}

fn is_black(midi: u8) -> bool {
    matches!(midi % 12, 1 | 3 | 6 | 8 | 10)
}

fn hsv(h: f32, s: f32, v: f32) -> Color32 {
    let h = (h.fract() * 6.0).abs();
    let c = v * s;
    let x = c * (1.0 - (h % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = if h < 1.0 {
        (c, x, 0.0)
    } else if h < 2.0 {
        (x, c, 0.0)
    } else if h < 3.0 {
        (0.0, c, x)
    } else if h < 4.0 {
        (0.0, x, c)
    } else if h < 5.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    Color32::from_rgb(
        ((r + m) * 255.0) as u8,
        ((g + m) * 255.0) as u8,
        ((b + m) * 255.0) as u8,
    )
}
