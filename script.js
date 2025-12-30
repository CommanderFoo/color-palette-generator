/* --- State Management --- */
const app_state = {
    current_palette: [], // Array of Swatch objects: { color: "#xxxxxx", locked: false, id: "..." }
    saved_palettes: [],  // Array of saved palettes: { id, name, colors: [] }
    settings: {
        harmony: "analogous",
        base_color: "#646cff",
        theme: "light",
        swatch_count: 5,
        simulation_mode: "none" // none, protanopia, deuteranopia, tritanopia
    },
    saved_gradients: [] // Array of { id, name, type, angle, colors: [{color, stop}] }
};

// Limits: min 3, max 16 swatches
const MIN_SWATCHES = 3;
const MAX_SWATCHES = 16;

// Gradient state (separate from app_state for simplicity)
const gradient_state = {
    type: "linear", // linear or radial
    angle: 90,
    colors: [] // Array of {color: hex, stop: 0-100} objects
};

// Color clipboard for copy/paste between swatches
let color_clipboard = null;

// Extraction state
const extraction_state = {
    image_data: null,
    extracted_colors: []
};

/* --- Color-Blind Simulation Matrices --- */
// Matrices based on research by Brettel, Viénot, and Mollon
const COLORBLIND_MATRICES = {
    protanopia: [
        [0.567, 0.433, 0.000],
        [0.558, 0.442, 0.000],
        [0.000, 0.242, 0.758]
    ],
    deuteranopia: [
        [0.625, 0.375, 0.000],
        [0.700, 0.300, 0.000],
        [0.000, 0.300, 0.700]
    ],
    tritanopia: [
        [0.950, 0.050, 0.000],
        [0.000, 0.433, 0.567],
        [0.000, 0.475, 0.525]
    ]
};

/* --- Accessibility Utilities --- */

/**
 * Converts HEX to RGB object {r, g, b} (0-255).
 */
function hex_to_rgb(hex) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    return { r, g, b };
}

/**
 * Converts RGB object to HEX string.
 */
function rgb_to_hex(r, g, b) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return "#" + [r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("");
}

/**
 * Calculates relative luminance per WCAG 2.1.
 */
function calculate_relative_luminance(hex) {
    const { r, g, b } = hex_to_rgb(hex);
    const srgb = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * Calculates WCAG contrast ratio between two colors.
 */
function calculate_contrast_ratio(hex1, hex2) {
    const l1 = calculate_relative_luminance(hex1);
    const l2 = calculate_relative_luminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns WCAG compliance level for a contrast ratio.
 */
function get_wcag_compliance(ratio) {
    if (ratio >= 7) {
        return "AAA";
    }
    if (ratio >= 4.5) {
        return "AA";
    }
    return "Fail";
}

/**
 * Applies color-blind simulation filter to a HEX color.
 */
function apply_colorblind_filter(hex, type) {
    if (type === "none" || !COLORBLIND_MATRICES[type]) {
        return hex;
    }
    const { r, g, b } = hex_to_rgb(hex);
    const matrix = COLORBLIND_MATRICES[type];
    const new_r = matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b;
    const new_g = matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b;
    const new_b = matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b;
    return rgb_to_hex(new_r, new_g, new_b);
}

/**
 * Gets the best contrast color (black or white) for text on a background.
 */
function get_contrast_text_color(background_hex) {
    const lum = calculate_relative_luminance(background_hex);
    return lum > 0.179 ? "#222222" : "#ffffff";
}

/* --- Color Utilities --- */

/**
 * Converts HSL values to HEX string.
 */
function hsl_to_hex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Converts HEX string to HSL object {h, s, l}.
 */
function hex_to_hsl(hex) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = "0x" + hex[1] + hex[1];
        g = "0x" + hex[2] + hex[2];
        b = "0x" + hex[3] + hex[3];
    } else if (hex.length === 7) {
        r = "0x" + hex[1] + hex[2];
        g = "0x" + hex[3] + hex[4];
        b = "0x" + hex[5] + hex[6];
    }
    r /= 255;
    g /= 255;
    b /= 255;
    let cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin;
    let h = 0, s = 0, l = 0;

    if (delta === 0) {
        h = 0;
    } else if (cmax === r) {
        h = ((g - b) / delta) % 6;
    } else if (cmax === g) {
        h = (b - r) / delta + 2;
    } else {
        h = (r - g) / delta + 4;
    }

    h = Math.round(h * 60);
    if (h < 0) {
        h += 360;
    }

    l = (cmax + cmin) / 2;
    s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    s = +(s * 100).toFixed(1);
    l = +(l * 100).toFixed(1);

    return { h, s, l };
}

/**
 * Generates a random integer between min and max.
 */
function random_int(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random HEX color.
 */
function generate_random_hex() {
    const h = random_int(0, 360);
    const s = random_int(40, 90);
    const l = random_int(40, 60);
    return hsl_to_hex(h, s, l);
}

/* --- Harmony Logic --- */

/**
 * Generates a palette based on base color and strategy.
 * Returns array of HEX strings.
 */
function calculate_harmony_colors(base_hex, strategy, count) {
    const hsl = hex_to_hsl(base_hex);
    const colors = [];

    for (let i = 0; i < count; i++) {
        let h = hsl.h;
        let s = hsl.s;
        let l = hsl.l;

        switch (strategy) {
            case "analogous":
                // Center around base, shift by 30deg steps
                const offset_analog = (i - Math.floor(count / 2)) * 25;
                h = (h + offset_analog + 360) % 360;
                break;
            case "monochromatic":
                // Vary lightness more evenly
                l = Math.max(15, Math.min(85, 20 + (i * (60 / Math.max(1, count - 1)))));
                s = Math.max(20, Math.min(90, s - (i * 3)));
                break;
            case "triadic":
                h = (h + (Math.floor(i % 3) * 120)) % 360;
                if (i >= 3) {
                    l = Math.max(25, Math.min(75, l + ((i - 3) * 12)));
                }
                break;
            case "tetradic":
                h = (h + (Math.floor(i % 4) * 90)) % 360;
                if (i >= 4) {
                    l = Math.max(30, Math.min(70, l + ((i - 4) * 10)));
                }
                break;
            case "complementary":
                if (i % 2 === 1) {
                    h = (h + 180) % 360;
                }
                if (i >= 2) {
                    l = Math.max(25, Math.min(80, l + ((i - 1) * 8)));
                }
                break;
            case "split_complementary":
                if (i === 0) {
                    // Base color
                } else if (i % 3 === 1) {
                    h = (h + 150) % 360;
                } else if (i % 3 === 2) {
                    h = (h + 210) % 360;
                }
                if (i >= 3) {
                    l = Math.max(25, Math.min(75, l + ((i - 2) * 10)));
                }
                break;
            default:
                h = (h + (i * 30)) % 360;
        }

        colors.push(hsl_to_hex(h, s, l));
    }

    return colors;
}

/**
 * CIELAB Color Space Conversion Utilities
 * Based on D65 illuminant and sRGB profile.
 */

function rgb_to_lab(r, g, b) {
    // 1. sRGB to linear RGB
    const f_rgb = (v) => {
        v /= 255;
        return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    };
    const lr = f_rgb(r);
    const lg = f_rgb(g);
    const lb = f_rgb(b);

    // 2. linear RGB to XYZ (D65)
    let x = lr * 0.4124 + lg * 0.3576 + lb * 0.1805;
    let y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    let z = lr * 0.0193 + lg * 0.1192 + lb * 0.9505;

    // 3. XYZ to Lab
    // Reference White: D65 (Xn=95.047, Yn=100.000, Zn=108.883)
    x /= 0.95047;
    y /= 1.00000;
    z /= 1.08883;

    const f_xyz = (t) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);
    const fx = f_xyz(x);
    const fy = f_xyz(y);
    const fz = f_xyz(z);

    return {
        l: 116 * fy - 16,
        a: 500 * (fx - fy),
        b: 200 * (fy - fz)
    };
}

function lab_to_rgb(l, a, b) {
    // 1. Lab to XYZ
    const fy = (l + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;

    const f_inv = (t) => (Math.pow(t, 3) > 0.008856 ? Math.pow(t, 3) : (t - 16 / 116) / 7.787);
    let x = 0.95047 * f_inv(fx);
    let y = 1.00000 * f_inv(fy);
    let z = 1.08883 * f_inv(fz);

    // 2. XYZ to linear RGB
    let lr = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let lg = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let lb = x * 0.0557 + y * -0.2040 + z * 1.0570;

    // 3. linear RGB to sRGB
    const f_inv_rgb = (v) => {
        v = v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
        return Math.max(0, Math.min(255, Math.round(v * 255)));
    };

    return {
        r: f_inv_rgb(lr),
        g: f_inv_rgb(lg),
        b: f_inv_rgb(lb)
    };
}

/* --- Core Application Logic --- */

function init_app() {
    load_from_local_storage();

    // Initialize DOM elements
    const generate_btn = document.getElementById("generate_btn");
    const random_btn = document.getElementById("random_btn");
    const add_btn = document.getElementById("add_swatch_btn");
    const remove_btn = document.getElementById("remove_swatch_btn");
    const theme_btn = document.getElementById("theme_toggle_btn");
    const base_input = document.getElementById("base_color_input");
    const harmony_select = document.getElementById("harmony_select");
    const export_btn = document.getElementById("export_btn");
    const save_palette_btn = document.getElementById("save_palette_btn");
    const saved_palettes_btn = document.getElementById("saved_palettes_btn");
    const confirm_save_btn = document.getElementById("confirm_save_btn");
    const help_btn = document.getElementById("help_btn");
    const simulation_select = document.getElementById("simulation_select");

    // Event Listeners
    generate_btn.addEventListener("click", () => handle_generate_palette());
    random_btn.addEventListener("click", handle_randomize);
    add_btn.addEventListener("click", () => modify_swatch_count(1));
    remove_btn.addEventListener("click", () => modify_swatch_count(-1));
    theme_btn.addEventListener("click", toggle_theme);

    base_input.addEventListener("input", (e) => {
        app_state.settings.base_color = e.target.value;
        document.getElementById("base_color_hex").textContent = e.target.value;
    });

    harmony_select.addEventListener("change", (e) => {
        app_state.settings.harmony = e.target.value;
    });

    simulation_select.addEventListener("change", (e) => {
        app_state.settings.simulation_mode = e.target.value;
        render_palette();
        save_to_local_storage();
    });

    export_btn.addEventListener("click", () => show_modal("export_modal"));
    save_palette_btn.addEventListener("click", () => show_modal("save_palette_modal"));
    saved_palettes_btn.addEventListener("click", () => {
        render_saved_palettes();
        show_modal("saved_palettes_modal");
    });
    confirm_save_btn.addEventListener("click", handle_save_palette);
    help_btn.addEventListener("click", () => show_modal("help_modal"));

    const accessibility_help_btn = document.getElementById("accessibility_help_btn");
    accessibility_help_btn.addEventListener("click", () => show_modal("accessibility_help_modal"));

    // Image Extractor
    document.getElementById("open_image_extractor").addEventListener("click", () => {
        show_modal("image_extractor_modal");
    });
    setup_image_extractor();

    // Setup close modal buttons
    document.querySelectorAll(".close_modal_btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const modal_id = e.currentTarget.dataset.modal || "export_modal";
            hide_modal(modal_id);
        });
    });

    // Close modal on backdrop click
    document.querySelectorAll(".modal").forEach(modal => {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                hide_modal(modal.id);
            }
        });
    });

    // Setup Export Actions
    document.querySelectorAll(".export_action").forEach(btn => {
        btn.addEventListener("click", (e) => handle_export(e.currentTarget.dataset.format));
    });

    // Theme Init
    apply_theme(app_state.settings.theme);

    // Sync UI with loaded state
    document.getElementById("harmony_select").value = app_state.settings.harmony;
    document.getElementById("base_color_input").value = app_state.settings.base_color;
    document.getElementById("base_color_hex").textContent = app_state.settings.base_color;
    document.getElementById("simulation_select").value = app_state.settings.simulation_mode;
    update_swatch_count_display();

    // Initial Generation if empty
    if (app_state.current_palette.length === 0) {
        handle_randomize();
    } else {
        render_palette();
    }

    // Initialize gradient builder
    init_gradient_builder();
    setup_swatch_click_for_gradient();
}

function handle_generate_palette() {
    const count = app_state.settings.swatch_count;
    const strategy = app_state.settings.harmony;
    const base = app_state.settings.base_color;

    const new_colors = calculate_harmony_colors(base, strategy, count);
    const new_palette_state = [];

    for (let i = 0; i < count; i++) {
        const existing = app_state.current_palette[i];
        if (existing && existing.locked) {
            new_palette_state.push(existing);
        } else {
            const color_val = new_colors[i] || generate_random_hex();
            new_palette_state.push({
                id: crypto.randomUUID(),
                color: color_val,
                locked: false
            });
        }
    }

    app_state.current_palette = new_palette_state;
    render_palette();
    save_to_local_storage();
}

function handle_randomize() {
    const random_base = generate_random_hex();
    app_state.settings.base_color = random_base;
    document.getElementById("base_color_input").value = random_base;
    document.getElementById("base_color_hex").textContent = random_base;

    handle_generate_palette();
}

function modify_swatch_count(delta) {
    const new_count = app_state.settings.swatch_count + delta;
    if (new_count < MIN_SWATCHES || new_count > MAX_SWATCHES) {
        return;
    }

    app_state.settings.swatch_count = new_count;
    update_swatch_count_display();

    if (delta > 0) {
        // Add - regenerate to fill
        handle_generate_palette();
    } else {
        // Remove from end
        app_state.current_palette.pop();
        render_palette();
        save_to_local_storage();
    }
}

function update_swatch_count_display() {
    const display = document.getElementById("swatch_count_display");
    if (display) {
        display.textContent = app_state.settings.swatch_count;
    }
}

/* --- Rendering --- */

function render_palette() {
    const container = document.getElementById("palette_container");
    container.innerHTML = "";

    const simulation = app_state.settings.simulation_mode;

    app_state.current_palette.forEach((swatch_data, index) => {
        const original_color = swatch_data.color;
        const display_color = apply_colorblind_filter(original_color, simulation);

        const swatch_el = document.createElement("div");
        swatch_el.className = "swatch";
        swatch_el.style.backgroundColor = display_color;
        swatch_el.draggable = true;
        swatch_el.dataset.index = index;

        // Calculate contrast with white and black
        const contrast_white = calculate_contrast_ratio(original_color, "#ffffff");
        const contrast_black = calculate_contrast_ratio(original_color, "#000000");
        const compliance_white = get_wcag_compliance(contrast_white);
        const compliance_black = get_wcag_compliance(contrast_black);

        // Text color for controls
        const text_color = get_contrast_text_color(display_color);

        // Build contrast badge HTML
        const white_badge_class = compliance_white === "AAA" ? "badge_aaa" : (compliance_white === "AA" ? "badge_aa" : "badge_fail");
        const black_badge_class = compliance_black === "AAA" ? "badge_aaa" : (compliance_black === "AA" ? "badge_aa" : "badge_fail");

        swatch_el.innerHTML = `
            <div class="swatch_controls">
                <button class="copy_color_btn" data-index="${index}" title="Copy Color" style="color: ${text_color}">
                    <i class="fa-solid fa-copy"></i>
                </button>
                <button class="paste_color_btn" data-index="${index}" title="Paste Color" style="color: ${text_color}; opacity: ${color_clipboard ? 1 : 0.3}">
                    <i class="fa-solid fa-paste"></i>
                </button>
                <button class="edit_btn" data-index="${index}" title="Edit Color" style="color: ${text_color}">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="lock_btn ${swatch_data.locked ? "locked" : ""}"
                        data-index="${index}"
                        title="${swatch_data.locked ? "Unlock" : "Lock"}"
                        style="color: ${swatch_data.locked ? "var(--primary-color)" : text_color}">
                    <i class="fa-solid ${swatch_data.locked ? "fa-lock" : "fa-lock-open"}"></i>
                </button>
            </div>
            <div class="contrast_badges">
                <span class="contrast_badge ${white_badge_class}" title="Contrast with white: ${contrast_white.toFixed(1)}:1">
                    <i class="fa-solid fa-circle" style="color:#fff"></i> ${compliance_white}
                </span>
                <span class="contrast_badge ${black_badge_class}" title="Contrast with black: ${contrast_black.toFixed(1)}:1">
                    <i class="fa-solid fa-circle" style="color:#000"></i> ${compliance_black}
                </span>
            </div>
            <div class="swatch_info">
                <span class="color_hex" data-color="${original_color}">${original_color}</span>
                ${simulation !== "none" ? `<span class="simulated_label">Simulated: ${display_color}</span>` : ""}
            </div>
            <input type="color" class="hidden_color_picker" value="${original_color}" style="display:none;">
        `;

        // Event delegation for swatch controls
        const lock_btn = swatch_el.querySelector(".lock_btn");
        const edit_btn = swatch_el.querySelector(".edit_btn");
        const copy_btn = swatch_el.querySelector(".copy_color_btn");
        const paste_btn = swatch_el.querySelector(".paste_color_btn");
        const color_hex = swatch_el.querySelector(".color_hex");
        const hidden_picker = swatch_el.querySelector(".hidden_color_picker");

        lock_btn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggle_lock(index);
        });

        edit_btn.addEventListener("click", (e) => {
            e.stopPropagation();
            hidden_picker.click();
        });

        copy_btn.addEventListener("click", (e) => {
            e.stopPropagation();
            color_clipboard = original_color;
            show_toast(`Copied ${original_color}`);
            render_palette(); // Update paste button opacity
        });

        paste_btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (color_clipboard) {
                update_swatch_color(index, color_clipboard);
                show_toast(`Pasted ${color_clipboard}`);
            }
        });

        hidden_picker.addEventListener("input", (e) => {
            update_swatch_color(index, e.target.value);
        });

        color_hex.addEventListener("click", (e) => {
            e.stopPropagation();
            copy_to_clipboard(original_color);
        });

        // Click swatch to add to gradient when gradient modal is open
        swatch_el.addEventListener("click", (e) => {
            const gradient_modal = document.getElementById("gradient_modal");
            if (gradient_modal && gradient_modal.classList.contains("visible")) {
                e.preventDefault();
                e.stopPropagation();
                add_color_to_gradient(original_color);
            }
        });

        // Drag Events
        swatch_el.addEventListener("dragstart", handle_drag_start);
        swatch_el.addEventListener("dragover", handle_drag_over);
        swatch_el.addEventListener("drop", handle_drop);
        swatch_el.addEventListener("dragend", handle_drag_end);

        container.appendChild(swatch_el);
    });
}

function toggle_lock(index) {
    app_state.current_palette[index].locked = !app_state.current_palette[index].locked;
    render_palette();
    save_to_local_storage();
}

function update_swatch_color(index, new_color) {
    app_state.current_palette[index].color = new_color;
    render_palette();
    save_to_local_storage();
}

function copy_to_clipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        show_toast(`Copied ${text}`);
    });
}

/* --- Drag and Drop --- */

let dragged_item_index = null;

function handle_drag_start(e) {
    dragged_item_index = +this.dataset.index;
    this.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
}

function handle_drag_over(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return false;
}

function handle_drop(e) {
    e.stopPropagation();
    const dropped_index = +this.dataset.index;

    if (dragged_item_index !== dropped_index) {
        const item = app_state.current_palette.splice(dragged_item_index, 1)[0];
        app_state.current_palette.splice(dropped_index, 0, item);

        render_palette();
        save_to_local_storage();
    }
    return false;
}

function handle_drag_end() {
    this.classList.remove("dragging");
}

/* --- Theme --- */

function toggle_theme() {
    app_state.settings.theme = app_state.settings.theme === "light" ? "dark" : "light";
    apply_theme(app_state.settings.theme);
    save_to_local_storage();
}

function apply_theme(theme_name) {
    document.documentElement.setAttribute("data-theme", theme_name);
    const icon = document.querySelector("#theme_toggle_btn i");
    if (theme_name === "dark") {
        icon.className = "fa-solid fa-sun";
    } else {
        icon.className = "fa-solid fa-moon";
    }
}

/* --- Storage --- */

function save_to_local_storage() {
    localStorage.setItem("chroma_gen_data", JSON.stringify(app_state));
}

function load_from_local_storage() {
    const data = localStorage.getItem("chroma_gen_data");
    if (data) {
        const parsed = JSON.parse(data);
        app_state.current_palette = parsed.current_palette || [];
        app_state.saved_palettes = parsed.saved_palettes || [];
        app_state.saved_gradients = parsed.saved_gradients || [];
        app_state.settings = { ...app_state.settings, ...parsed.settings };
    }
}

/* --- Saved Palettes --- */

function handle_save_palette() {
    const name_input = document.getElementById("palette_name_input");
    const name = name_input.value.trim() || `Palette ${app_state.saved_palettes.length + 1}`;

    const palette_to_save = {
        id: crypto.randomUUID(),
        name: name,
        colors: app_state.current_palette.map(s => s.color),
        created_at: new Date().toISOString()
    };

    app_state.saved_palettes.push(palette_to_save);
    save_to_local_storage();

    name_input.value = "";
    hide_modal("save_palette_modal");
    show_toast(`Saved "${name}"`);
}

function render_saved_palettes() {
    const list = document.getElementById("saved_palettes_list");

    if (app_state.saved_palettes.length === 0) {
        list.innerHTML = `<p class="empty_list_message">No saved palettes yet. Click "Save" to add one!</p>`;
        return;
    }

    list.innerHTML = app_state.saved_palettes.map(palette => `
        <div class="saved_palette_item" data-id="${palette.id}">
            <div class="saved_palette_header">
                <span class="saved_palette_name">${palette.name}</span>
                <div class="saved_palette_actions">
                    <button class="load_btn" title="Load Palette" data-id="${palette.id}">
                        <i class="fa-solid fa-upload"></i>
                    </button>
                    <button class="delete_btn" title="Delete Palette" data-id="${palette.id}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="saved_palette_preview">
                ${palette.colors.map(c => `<div class="preview_swatch" style="background:${c}"></div>`).join("")}
            </div>
        </div>
    `).join("");

    // Attach event listeners
    list.querySelectorAll(".load_btn").forEach(btn => {
        btn.addEventListener("click", () => load_saved_palette(btn.dataset.id));
    });

    list.querySelectorAll(".delete_btn").forEach(btn => {
        btn.addEventListener("click", () => delete_saved_palette(btn.dataset.id));
    });
}

function load_saved_palette(id) {
    const palette = app_state.saved_palettes.find(p => p.id === id);
    if (!palette) {
        return;
    }

    app_state.current_palette = palette.colors.map(color => ({
        id: crypto.randomUUID(),
        color: color,
        locked: false
    }));
    app_state.settings.swatch_count = palette.colors.length;

    update_swatch_count_display();
    render_palette();
    save_to_local_storage();
    hide_modal("saved_palettes_modal");
    show_toast(`Loaded "${palette.name}"`);
}

function delete_saved_palette(id) {
    const index = app_state.saved_palettes.findIndex(p => p.id === id);
    if (index === -1) {
        return;
    }

    const name = app_state.saved_palettes[index].name;
    app_state.saved_palettes.splice(index, 1);
    save_to_local_storage();
    render_saved_palettes();
    show_toast(`Deleted "${name}"`);
}

/* --- Modal Helpers --- */

function show_modal(modal_id) {
    document.getElementById(modal_id).classList.add("visible");
}

function hide_modal(modal_id) {
    document.getElementById(modal_id).classList.remove("visible");
}

/* --- Toast --- */

function show_toast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}

/* --- Export Logic --- */

function handle_export(format) {
    if (format === "png") {
        download_palette_as_png();
        return;
    }

    let text_output = "";

    app_state.current_palette.forEach((swatch, idx) => {
        if (format === "hex") {
            text_output += swatch.color + "\n";
        } else if (format === "rgb") {
            const hex = swatch.color;
            const r = parseInt(hex.substr(1, 2), 16);
            const g = parseInt(hex.substr(3, 2), 16);
            const b = parseInt(hex.substr(5, 2), 16);
            text_output += `rgb(${r}, ${g}, ${b})\n`;
        } else if (format === "hsl") {
            const hsl = hex_to_hsl(swatch.color);
            text_output += `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)\n`;
        } else if (format === "css") {
            text_output += `--color-${idx + 1}: ${swatch.color};\n`;
        }
    });

    navigator.clipboard.writeText(text_output).then(() => {
        show_toast("Copied to clipboard!");
        hide_modal("export_modal");
    });
}

function download_palette_as_png() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const count = app_state.current_palette.length;
    const swatch_width = 200;
    const w = swatch_width * count;
    const h = 600;
    canvas.width = w;
    canvas.height = h;

    app_state.current_palette.forEach((swatch, i) => {
        ctx.fillStyle = swatch.color;
        ctx.fillRect(i * swatch_width, 0, swatch_width, h);

        // Determine text color based on luminance
        const hsl = hex_to_hsl(swatch.color);
        ctx.fillStyle = hsl.l > 55 ? "#222222" : "#ffffff";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";

        ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
        ctx.shadowBlur = 4;

        ctx.fillText(swatch.color.toUpperCase(), (i * swatch_width) + (swatch_width / 2), h - 40);
        ctx.shadowBlur = 0;
    });

    const link = document.createElement("a");
    link.download = "color_palette.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    hide_modal("export_modal");
    show_toast("PNG downloaded!");
}
/* --- Gradient Builder --- */

function init_gradient_builder() {
    const gradient_btn = document.getElementById("gradient_btn");
    const copy_css_btn = document.getElementById("copy_gradient_css");
    const angle_slider = document.getElementById("gradient_angle");
    const angle_value = document.getElementById("angle_value");
    const type_toggles = document.querySelectorAll(".toggle_btn[data-type]");
    const angle_presets = document.querySelectorAll(".angle_preset");

    gradient_btn.addEventListener("click", () => {
        // Initialize with first 2 colors from palette
        if (gradient_state.colors.length === 0 && app_state.current_palette.length >= 2) {
            gradient_state.colors = [
                { color: app_state.current_palette[0].color, stop: 0 },
                { color: app_state.current_palette[1].color, stop: 100 }
            ];
        }
        render_gradient_colors();
        render_available_palette_colors();
        update_gradient_preview();
        show_modal("gradient_modal");
    });

    copy_css_btn.addEventListener("click", () => {
        const css = generate_gradient_css();
        navigator.clipboard.writeText(css).then(() => {
            show_toast("Gradient CSS copied!");
        });
    });

    angle_slider.addEventListener("input", (e) => {
        gradient_state.angle = parseInt(e.target.value);
        angle_value.textContent = gradient_state.angle + "°";
        update_gradient_preview();
    });

    type_toggles.forEach(btn => {
        btn.addEventListener("click", () => {
            type_toggles.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gradient_state.type = btn.dataset.type;

            // Show/hide angle controls for linear
            const angle_group = document.getElementById("angle_control_group");
            angle_group.style.display = gradient_state.type === "linear" ? "flex" : "none";

            update_gradient_preview();
        });
    });

    angle_presets.forEach(btn => {
        btn.addEventListener("click", () => {
            const angle = parseInt(btn.dataset.angle);
            gradient_state.angle = angle;
            angle_slider.value = angle;
            angle_value.textContent = angle + "°";
            update_gradient_preview();
        });
    });

    // Fade in/out buttons
    document.getElementById("add_fade_start").addEventListener("click", () => {
        if (gradient_state.colors.length >= 5) {
            show_toast("Maximum 5 colors allowed");
            return;
        }
        gradient_state.colors.unshift({ color: "transparent", stop: 0 });
        render_gradient_colors();
        update_gradient_preview();
        show_toast("Fade in added");
    });

    document.getElementById("add_fade_end").addEventListener("click", () => {
        if (gradient_state.colors.length >= 5) {
            show_toast("Maximum 5 colors allowed");
            return;
        }
        gradient_state.colors.push({ color: "transparent", stop: 100 });
        render_gradient_colors();
        update_gradient_preview();
        show_toast("Fade out added");
    });

    // Library and Save
    document.getElementById("open_gradient_library").addEventListener("click", () => {
        render_saved_gradients();
        show_modal("saved_gradients_modal");
    });

    document.getElementById("save_gradient_btn").addEventListener("click", () => {
        document.getElementById("gradient_name_input").value = "";
        show_modal("save_gradient_modal");
    });

    document.getElementById("confirm_save_gradient_btn").addEventListener("click", () => {
        const name = document.getElementById("gradient_name_input").value.trim() || "Untitled Gradient";
        save_current_gradient(name);
        hide_modal("save_gradient_modal");
    });

    // Export
    document.getElementById("open_gradient_export").addEventListener("click", () => {
        show_modal("export_gradient_modal");
    });

    document.querySelectorAll(".export_gradient_action").forEach(btn => {
        btn.addEventListener("click", (e) => handle_gradient_export(e.currentTarget.dataset.format));
    });
}

function add_color_to_gradient(hex) {
    if (gradient_state.colors.length >= 5) {
        show_toast("Maximum 5 colors allowed");
        return;
    }

    // Calculate a default stop (middle if there are gaps, otherwise end)
    let stop = 50;
    if (gradient_state.colors.length > 0) {
        const last_stop = gradient_state.colors[gradient_state.colors.length - 1].stop;
        stop = Math.min(100, last_stop + 20);
    }

    gradient_state.colors.push({ color: hex, stop: stop });
    render_gradient_colors();
    render_available_palette_colors();
    update_gradient_preview();
}

function remove_color_from_gradient(index) {
    if (gradient_state.colors.length <= 2) {
        show_toast("Minimum 2 colors required");
        return;
    }
    gradient_state.colors.splice(index, 1);
    render_gradient_colors();
    render_available_palette_colors();
    update_gradient_preview();
}

function render_gradient_colors() {
    const container = document.getElementById("gradient_colors");
    container.innerHTML = "";

    gradient_state.colors.forEach((item, index) => {
        const chip = document.createElement("div");
        chip.className = "gradient_color_chip";
        chip.draggable = true;
        chip.dataset.index = index;

        chip.innerHTML = `
            <div class="color_swatch" style="background: ${item.color}"></div>
            <div class="chip_controls">
                <span class="color_label">${item.color === "transparent" ? "Fade" : item.color}</span>
                <input type="range" class="stop_slider" min="0" max="100" value="${item.stop}" title="Position">
                <span class="stop_value">${item.stop}%</span>
            </div>
            <button class="remove_color" title="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        const slider = chip.querySelector(".stop_slider");
        const stop_value = chip.querySelector(".stop_value");

        slider.addEventListener("input", (e) => {
            const val = parseInt(e.target.value);
            gradient_state.colors[index].stop = val;
            stop_value.textContent = val + "%";
            update_gradient_preview();
        });

        // Prevent drag events and disable chip draggability when interacting with the slider
        slider.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            chip.draggable = false;
        });

        window.addEventListener("mouseup", () => {
            chip.draggable = true;
        });

        slider.addEventListener("touchstart", (e) => {
            e.stopPropagation();
            chip.draggable = false;
        }, { passive: true });

        window.addEventListener("touchend", () => {
            chip.draggable = true;
        });

        chip.querySelector(".remove_color").addEventListener("click", (e) => {
            e.stopPropagation();
            remove_color_from_gradient(index);
        });

        // Drag events for reordering
        chip.addEventListener("dragstart", (e) => {
            if (e.target.tagName.toLowerCase() === "input") return;
            e.dataTransfer.setData("text/plain", index);
            chip.style.opacity = "0.5";
        });

        chip.addEventListener("dragend", () => {
            chip.style.opacity = "1";
        });

        chip.addEventListener("dragover", (e) => {
            e.preventDefault();
        });

        chip.addEventListener("drop", (e) => {
            e.preventDefault();
            const from_index = parseInt(e.dataTransfer.getData("text/plain"));
            const to_index = index;
            if (from_index !== to_index) {
                const moved_item = gradient_state.colors.splice(from_index, 1)[0];
                gradient_state.colors.splice(to_index, 0, moved_item);
                render_gradient_colors();
                update_gradient_preview();
            }
        });

        container.appendChild(chip);
    });
}

function render_available_palette_colors() {
    const container = document.getElementById("available_palette_colors");
    container.innerHTML = "";

    app_state.current_palette.forEach((swatch) => {
        const btn = document.createElement("button");
        btn.className = "palette_color_btn";
        btn.style.background = swatch.color;
        btn.title = swatch.color;

        btn.addEventListener("click", () => {
            add_color_to_gradient(swatch.color);
        });

        container.appendChild(btn);
    });
}

function generate_gradient_css() {
    const stops = gradient_state.colors.map(c => `${c.color} ${c.stop}%`).join(", ");
    if (gradient_state.type === "linear") {
        return `background: linear-gradient(${gradient_state.angle}deg, ${stops});`;
    } else {
        return `background: radial-gradient(circle, ${stops});`;
    }
}

function update_gradient_preview() {
    const preview = document.getElementById("gradient_preview");
    const css_code = document.getElementById("gradient_css_code");

    if (gradient_state.colors.length < 2) {
        preview.style.background = "#ccc";
        css_code.textContent = "Add at least 2 colors";
        return;
    }

    const css = generate_gradient_css();
    preview.style.cssText = css;
    css_code.textContent = css;
}

/* --- Gradient Library --- */

function save_current_gradient(name) {
    const new_gradient = {
        id: crypto.randomUUID(),
        name: name,
        type: gradient_state.type,
        angle: gradient_state.angle,
        colors: JSON.parse(JSON.stringify(gradient_state.colors))
    };

    app_state.saved_gradients.push(new_gradient);
    save_to_local_storage();
    show_toast(`Saved "${name}"`);
}

function render_saved_gradients() {
    const list = document.getElementById("saved_gradients_list");
    if (app_state.saved_gradients.length === 0) {
        list.innerHTML = `<p class="empty_list_message">No saved gradients yet. Click "Save" to add one!</p>`;
        return;
    }

    list.innerHTML = app_state.saved_gradients.map(grad => {
        const stops = grad.colors.map(c => `${c.color} ${c.stop}%`).join(", ");
        const css = grad.type === "linear"
            ? `linear-gradient(${grad.angle}deg, ${stops})`
            : `radial-gradient(circle, ${stops})`;

        return `
            <div class="saved_gradient_item" data-id="${grad.id}">
                <div class="saved_gradient_header">
                    <span class="saved_gradient_name">${grad.name}</span>
                    <div class="saved_palette_actions">
                        <button class="load_grad_btn" title="Load Gradient" data-id="${grad.id}">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        <button class="delete_grad_btn" title="Delete Gradient" data-id="${grad.id}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="saved_gradient_preview" style="background: ${css}"></div>
            </div>
        `;
    }).join("");

    // Attach listeners
    list.querySelectorAll(".load_grad_btn").forEach(btn => {
        btn.addEventListener("click", () => load_saved_gradient(btn.dataset.id));
    });

    list.querySelectorAll(".delete_grad_btn").forEach(btn => {
        btn.addEventListener("click", () => delete_saved_gradient(btn.dataset.id));
    });
}

function load_saved_gradient(id) {
    const grad = app_state.saved_gradients.find(g => g.id === id);
    if (!grad) return;

    gradient_state.type = grad.type;
    gradient_state.angle = grad.angle;
    gradient_state.colors = JSON.parse(JSON.stringify(grad.colors));

    // Update UI
    document.querySelectorAll(".toggle_btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.type === grad.type);
    });

    const angle_slider = document.getElementById("gradient_angle");
    const angle_value = document.getElementById("angle_value");
    angle_slider.value = grad.angle;
    angle_value.textContent = grad.angle + "°";

    document.getElementById("angle_control_group").style.display = grad.type === "linear" ? "flex" : "none";

    render_gradient_colors();
    update_gradient_preview();
    hide_modal("saved_gradients_modal");
    show_toast(`Loaded "${grad.name}"`);
}

function delete_saved_gradient(id) {
    const index = app_state.saved_gradients.findIndex(g => g.id === id);
    if (index === -1) return;

    const name = app_state.saved_gradients[index].name;
    app_state.saved_gradients.splice(index, 1);
    save_to_local_storage();
    render_saved_gradients();
    show_toast(`Deleted "${name}"`);
}

/* --- Gradient Export --- */

function handle_gradient_export(format) {
    const css = generate_gradient_css();

    if (format === "css_full") {
        navigator.clipboard.writeText(css).then(() => {
            show_toast("Full CSS Background copied!");
            hide_modal("export_gradient_modal");
        });
    } else if (format === "css_value") {
        const stops = gradient_state.colors.map(c => `${c.color} ${c.stop}%`).join(", ");
        const val = gradient_state.type === "linear"
            ? `linear-gradient(${gradient_state.angle}deg, ${stops})`
            : `radial-gradient(circle, ${stops})`;
        navigator.clipboard.writeText(val).then(() => {
            show_toast("Gradient value copied!");
            hide_modal("export_gradient_modal");
        });
    } else if (format === "png") {
        download_gradient_png();
        hide_modal("export_gradient_modal");
    } else if (format === "svg") {
        download_gradient_svg();
        hide_modal("export_gradient_modal");
    }
}

function download_gradient_png() {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");

    let grad;
    const stops = gradient_state.colors;

    if (gradient_state.type === "linear") {
        const angle_rad = (gradient_state.angle - 90) * (Math.PI / 180);
        const x1 = 960 - Math.cos(angle_rad) * 1100;
        const y1 = 540 - Math.sin(angle_rad) * 1100;
        const x2 = 960 + Math.cos(angle_rad) * 1100;
        const y2 = 540 + Math.sin(angle_rad) * 1100;
        grad = ctx.createLinearGradient(x1, y1, x2, y2);
    } else {
        grad = ctx.createRadialGradient(960, 540, 0, 960, 540, 1100);
    }

    stops.forEach(s => {
        grad.addColorStop(s.stop / 100, s.color === "transparent" ? "rgba(0,0,0,0)" : s.color);
    });

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1920, 1080);

    const link = document.createElement("a");
    link.download = `gradient-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    show_toast("PNG Downloaded");
}

function download_gradient_svg() {
    const stops = gradient_state.colors.map(s =>
        `<stop offset="${s.stop}%" stop-color="${s.color === "transparent" ? "black" : s.color}" stop-opacity="${s.color === "transparent" ? "0" : "1"}" />`
    ).join("");

    let defs = "";
    if (gradient_state.type === "linear") {
        const x2 = Math.cos(gradient_state.angle * Math.PI / 180) * 100;
        const y2 = Math.sin(gradient_state.angle * Math.PI / 180) * 100;
        defs = `<linearGradient id="grad" x1="0%" y1="0%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`;
    } else {
        defs = `<radialGradient id="grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">${stops}</radialGradient>`;
    }

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs>${defs}</defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.download = `gradient-${Date.now()}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    show_toast("SVG Downloaded");
}

// Make swatches clickable to add to gradient when modal is open
function setup_swatch_click_for_gradient() {
    document.getElementById("palette_container").addEventListener("click", (e) => {
        const gradient_modal = document.getElementById("gradient_modal");
        if (!gradient_modal.classList.contains("visible")) {
            return;
        }

        const swatch = e.target.closest(".swatch");
        if (swatch) {
            const index = parseInt(swatch.dataset.index);
            const color = app_state.current_palette[index].color;
            add_color_to_gradient(color);
        }
    });
}

// Boot
window.addEventListener("DOMContentLoaded", init_app);

/* --- Image Extraction Logic --- */

function setup_image_extractor() {
    const drop_zone = document.getElementById("image_drop_zone");
    const image_input = document.getElementById("image_input");
    const count_slider = document.getElementById("extraction_color_count");
    const count_val = document.getElementById("extraction_count_val");
    const extract_btn = document.getElementById("extract_palette_btn");
    const apply_btn = document.getElementById("apply_extracted_palette");
    const remove_btn = document.getElementById("remove_image_btn");

    drop_zone.addEventListener("click", () => image_input.click());

    image_input.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handle_image_file(e.target.files[0]);
        }
    });

    ["dragenter", "dragover", "dragleave", "drop"].forEach(name => {
        drop_zone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ["dragenter", "dragover"].forEach(name => {
        drop_zone.addEventListener(name, () => drop_zone.classList.add("drag_over"), false);
    });

    ["dragleave", "drop"].forEach(name => {
        drop_zone.addEventListener(name, () => drop_zone.classList.remove("drag_over"), false);
    });

    drop_zone.addEventListener("drop", (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) {
            handle_image_file(file);
        }
    });

    count_slider.addEventListener("input", (e) => {
        count_val.textContent = e.target.value;
    });

    extract_btn.addEventListener("click", () => {
        extract_colors_from_image(parseInt(count_slider.value));
    });

    remove_btn.addEventListener("click", () => {
        clear_extractor();
    });

    apply_btn.addEventListener("click", () => {
        apply_extracted_palette();
    });

    // Global Paste Support for Extractor
    window.addEventListener("paste", (e) => {
        const modal = document.getElementById("image_extractor_modal");
        if (!modal.classList.contains("visible")) {
            return;
        }

        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                const file = items[i].getAsFile();
                handle_image_file(file);
                break;
            }
        }
    });
}

function handle_image_file(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            extraction_state.image_data = img;

            const preview = document.getElementById("extractor_image_preview");
            preview.src = e.target.result;

            document.getElementById("image_drop_zone").classList.add("hidden");
            document.getElementById("extractor_preview_container").classList.remove("hidden");
            document.getElementById("extract_palette_btn").disabled = false;
        };

        img.src = e.target.result;
    };

    reader.readAsDataURL(file);
}

function clear_extractor() {
    extraction_state.image_data = null;
    extraction_state.extracted_colors = [];

    document.getElementById("image_input").value = "";
    document.getElementById("extractor_image_preview").src = "";
    document.getElementById("image_drop_zone").classList.remove("hidden");
    document.getElementById("extractor_preview_container").classList.add("hidden");
    document.getElementById("extract_palette_btn").disabled = true;
    document.getElementById("apply_extracted_palette").disabled = true;
}

function extract_colors_from_image(count) {
    const img = extraction_state.image_data;
    if (!img) {
        return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Scale down for performance
    const max_dim = 200;
    let width = img.width;
    let height = img.height;

    if (width > height) {
        if (width > max_dim) {
            height *= max_dim / width;
            width = max_dim;
        }
    } else {
        if (height > max_dim) {
            width *= max_dim / height;
            height = max_dim;
        }
    }

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        // Skip fully transparent pixels
        if (data[i + 3] < 128) continue;
        pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }

    // K-Means Clustering in Lab Space
    const quantized = k_means_clustering(pixels, count);
    const all_hex = quantized.map(p => rgb_to_hex(p.r, p.g, p.b));
    extraction_state.extracted_colors = [...new Set(all_hex)];

    render_extracted_swatches();
    document.getElementById("apply_extracted_palette").disabled = false;

    const unique_count = extraction_state.extracted_colors.length;
    show_toast(unique_count < count ? `Extracted ${unique_count} unique colors` : `Extracted ${count} colors`);
}

function k_means_clustering(pixels, k) {
    if (pixels.length === 0) return [];
    if (pixels.length <= k) return pixels;

    // Convert pixels to Lab
    const labs = pixels.map(p => rgb_to_lab(p.r, p.g, p.b));

    // Simple initialization: random selection from pixels
    let centroids = [];
    const used_indices = new Set();
    while (centroids.length < k && used_indices.size < labs.length) {
        const idx = Math.floor(Math.random() * labs.length);
        if (!used_indices.has(idx)) {
            centroids.push({ ...labs[idx] });
            used_indices.add(idx);
        }
    }

    const iterations = 15;
    const assignments = new Array(labs.length);

    for (let iter = 0; iter < iterations; iter++) {
        // 1. Assignment Phase
        let changed = false;
        for (let i = 0; i < labs.length; i++) {
            const p = labs[i];
            let min_dist = Infinity;
            let best_k = 0;

            for (let j = 0; j < centroids.length; j++) {
                const c = centroids[j];
                const dl = p.l - c.l;
                const da = p.a - c.a;
                const db = p.b - c.b;
                const dist_sq = dl * dl + da * da + db * db;

                if (dist_sq < min_dist) {
                    min_dist = dist_sq;
                    best_k = j;
                }
            }

            if (assignments[i] !== best_k) {
                assignments[i] = best_k;
                changed = true;
            }
        }

        if (!changed && iter > 0) break;

        // 2. Update Phase
        const new_centroids = Array.from({ length: centroids.length }, () => ({ l: 0, a: 0, b: 0, count: 0 }));
        for (let i = 0; i < labs.length; i++) {
            const k_idx = assignments[i];
            const p = labs[i];
            new_centroids[k_idx].l += p.l;
            new_centroids[k_idx].a += p.a;
            new_centroids[k_idx].b += p.b;
            new_centroids[k_idx].count++;
        }

        for (let j = 0; j < centroids.length; j++) {
            const nc = new_centroids[j];
            if (nc.count > 0) {
                centroids[j].l = nc.l / nc.count;
                centroids[j].a = nc.a / nc.count;
                centroids[j].b = nc.b / nc.count;
            }
        }
    }

    // Convert centroids back to RGB
    return centroids.map(c => {
        const rgb = lab_to_rgb(c.l, c.a, c.b);
        return { r: rgb.r, g: rgb.g, b: rgb.b };
    });
}

function render_extracted_swatches() {
    const container = document.getElementById("extracted_swatches");
    container.innerHTML = extraction_state.extracted_colors.map(hex => `
        <div class="extracted_swatch" style="background: ${hex}" title="${hex}" data-hex="${hex}"></div>
    `).join("");
}

function apply_extracted_palette() {
    const colors = extraction_state.extracted_colors;
    if (colors.length === 0) return;

    app_state.settings.swatch_count = colors.length;
    app_state.current_palette = colors.map((hex, i) => ({
        id: crypto.randomUUID(),
        color: hex,
        locked: false
    }));

    render_palette();
    update_swatch_count_display();
    hide_modal("image_extractor_modal");
    show_toast("Applied extracted palette");
    save_to_local_storage();
}
