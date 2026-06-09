import WoDItemSheetV2 from "./item-sheet-v2.js";
import SelectHelper from "../../scripts/select-helpers.js";
import DropHelper from "../../scripts/drop-helpers.js";
import { ActionEdit, ActionRemove, ActionSwitch } from "../../scripts/item-actions.js";


const { HandlebarsApplicationMixin } = foundry.applications.api

/**
 * Extend the base ActorSheetV2 document
 * @extends {WoDItemSheetV2}
 */

export default class SplatItemSheet extends HandlebarsApplicationMixin(WoDItemSheetV2) {

    constructor(item, options) {
		super(item, options);      
        
        this.#dragDrop = this.#createDragDropHandlers();
	}

    /** Which bio row (array index) is expanded for editing; loose ObjectField entries may omit `key`. */
    #bioEditIndex = null;
    #bioAdding = false;

    /** @param {EventTarget|null} target */
    static #bioRowIndexFromTarget(target) {
        const el = target && /** @type {HTMLElement} */ (target).closest?.(".bio-field-item");
        // `data-bio-index` → dataset.bioIndex (not .bioindex)
        const raw = el?.dataset?.bioIndex ?? el?.dataset?.bioindex ?? el?.getAttribute?.("data-bio-index");
        if (raw === undefined || raw === "") return -1;
        const idx = parseInt(String(raw), 10);
        return Number.isInteger(idx) && idx >= 0 ? idx : -1;
    }

    static DEFAULT_OPTIONS = {
        form: {
            submitOnChange: true,
            handler:  SplatItemSheet.onSubmitItemForm
        },
        position: {
            width: 1000,
            height: 800
        },
        actions: {
            actionEdit: ActionEdit,
            actionRemove: ActionRemove,
            actionSwitch: ActionSwitch,
            splatBioToggleAdd: SplatItemSheet.#onSplatBioToggleAdd,
            splatBioConfirmAdd: SplatItemSheet.#onSplatBioConfirmAdd,
            splatBioCancelAdd: SplatItemSheet.#onSplatBioCancelAdd,
            splatBioToggleEdit: SplatItemSheet.#onSplatBioToggleEdit,
            splatBioRemoveField: SplatItemSheet.#onSplatBioRemoveField
        }
    }

    static PARTS = {
        header: {
            template: 'systems/worldofdarkness/templates/items/parts/header-sheet.hbs'
        },
        tab: {
            template: 'systems/worldofdarkness/templates/items/parts/navigation.hbs'
        },
        stats: {
            template: 'systems/worldofdarkness/templates/items/splat-sheet.hbs'
        },
        bio: {
            template: 'systems/worldofdarkness/templates/items/parts/splat-bio-tab.hbs'
        },
        abilities: {
            template: 'systems/worldofdarkness/templates/items/parts/splat-abilities-sheet.hbs'
        },
        features: {
            template: 'systems/worldofdarkness/templates/items/parts/splat-features-sheet.hbs'
        }
    }

    splat = "mortal";

    tabGroups = {
        primary: 'stats'
    }

    tabs = {
        stats: {
            id: 'stats',
            group: 'primary',
            title: 'wod.tab.settings'
        },
        bio: {
            id: 'bio',
            group: 'primary',
            title: 'wod.tab.bio'
        },
        abilities: {
            id: 'abilities',
            group: 'primary',
            title: 'wod.abilities.abilities'
        },
        features: {
            id: 'features',
            group: 'primary',
            title: 'wod.notes.features'
        }
    }

    getTabs() {
        const tabs = this.tabs

        for (const tab of Object.values(tabs)) {
            tab.active = this.tabGroups[tab.group] === tab.id;
            tab.cssClass = tab.active ? 'itemv2 item active' : 'itemv2 item';
        }

        return tabs;
    }

    getHealthLevels(item) {
        const health = {};

        for (const i in CONFIG.worldofdarkness.woundLevels) {
            health[i] = {
                label: item.system.health[i].label,
                value: item.system.health[i].value,
                penalty: item.system.health[i].penalty
            };
        }

        return health;
    }

    /** @override */
    async _prepareContext(options) {
        const data = await super._prepareContext();
        const item = this.item;
        const actor = this.item.actor;

        data.tabs = this.getTabs();
        data.healthlevels = this.getHealthLevels(this.item);
        data.listData = SelectHelper.SetupItem(item);
        //data.canEdit = this.item.isOwner || game.user.isGM;	

        if (item.actor != null) {
            data.hasActor = true;
            data.actor = item.actor;
        }
        else {
            data.hasActor = false;
        }

        data.item = item;

        // console.log(`${data.item.name} - (${data.item.type})`);
        // console.log(data.item);

        return {
            ...data
        }
    }

    async _preparePartContext (partId, context, options) {
        context = { ...(await super._preparePartContext(partId, context, options)) }

        // Top-level variables
        const item = this.item;

        // Only load what is neccessary
        switch (partId) {
            case 'stats':
                return prepareStatContext(context, item);
            case 'bio': {
                const bioContext = await prepareBioContext(context, item);
                bioContext.bioEditIndex = this.#bioEditIndex;
                bioContext.bioAdding = this.#bioAdding;
                return bioContext;
            }
            case 'abilities':
                return prepareAbilitiesContext(context, item);
            case 'features':
                return prepareFeaturesContext(context, item);
        }

        return context
    }	  

    async render(force = false, options = {}) {
		await super.render(force, options);
	}
    
    async _onRender() {
        const html = $(this.element);

        // Drag and drop functionality
        this.#dragDrop.forEach((d) => d.bind(this.element));
    }

    static async onSubmitItemForm(event, form, formData) {
        const target = event.target;
        // Provisional "new bio field id" input has no `name`; blur before clicking check
        // triggers submitOnChange and would otherwise clear #bioAdding / run super with empty name.
        if (target?.hasAttribute?.("data-splat-new-bio-key")) {
            return;
        }

        const name = typeof target?.name === "string" ? target.name : "";
        const bioFieldMatch = /^system\.bio\.(\d+)\.(.+)$/.exec(name);
        const tag = target?.tagName;
        const isBioControl =
            bioFieldMatch &&
            (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT");

        if (isBioControl) {
            const sheet = /** @type {SplatItemSheet} */ (this);
            const index = parseInt(bioFieldMatch[1], 10);
            const field = bioFieldMatch[2];
            if (field.includes(".") || !Number.isInteger(index) || index < 0) {
                await super.onSubmitItemForm(event, form, formData);
            } else {
                let value;
                if (target.type === "number") {
                    value = parseInt(target.value, 10);
                } else if (target.type === "checkbox") {
                    value = target.checked;
                } else {
                    value = target.value;
                }

                const bio = foundry.utils.duplicate(DropHelper.splatBioTemplateArray(sheet.item));
                if (!bio[index]) {
                    await super.onSubmitItemForm(event, form, formData);
                } else {
                    bio[index] = { ...bio[index], [field]: value };
                    await sheet.item.update({ "system.bio": bio }, { diff: false });
                }
            }

            const sheetAfter = /** @type {SplatItemSheet} */ (this);
            sheetAfter.#bioEditIndex = null;
            if (name.startsWith("system.bio.")) {
                sheetAfter.#bioAdding = false;
            }
            await sheetAfter.render();
            return;
        }

        await super.onSubmitItemForm(event, form, formData);

        const sheet = /** @type {SplatItemSheet} */ (this);
        sheet.#bioEditIndex = null;
        if (name.startsWith("system.bio.")) {
            sheet.#bioAdding = false;
        }
        await sheet.render();
    }
    
    #dragDrop

    #createDragDropHandlers () {
        return this.options.dragDrop.map((d) => {
            d.permissions = {
                dragstart: this._canDragStart.bind(this),
                drop: this._canDragDrop.bind(this)
            }

            d.callbacks = {
                dragstart: this._onDragStart.bind(this),
                dragover: this._onDragOver.bind(this),
                drop: this._onDrop.bind(this)
            }
            return new foundry.applications.ux.DragDrop.implementation(d);
        })
    }

    /**
     * Override _onDragStart to handle advantage reordering separately from ability category changes.
     * Advantages use type "SortOrder" for position-based sorting within the same list.
     * Abilities continue to use type "Sort" for moving between Talent/Skill/Knowledge categories.
     * @param {DragEvent} event - The drag start event
     */
    _onDragStart(event) {
        const dataset =
            event.target.closest("[data-drag]")?.dataset ?? event.currentTarget?.dataset ?? event.target.dataset;

        // Handle drag to order item lists (advantages, features, powers)
        if (dataset.list === "system.advantages" || dataset.list === "system.features" || dataset.list === "system.powers") {
            const data = {
                documentid: dataset.documentid,
                itemid: dataset.itemid,
                list: dataset.list,
                itemtype: dataset.type,
                type: "SortOrder"
            }
            event.dataTransfer.setData('text/plain', JSON.stringify(data));
            return;
        }

        // Bio rows use data-bio-index (incl. "0"); never fall through to super — that sets type Sort without data-field and breaks _onSortingItem.
        if (dataset.list === "system.bio") {
            const idx = SplatItemSheet.#bioRowIndexFromTarget(event.target);
            if (idx >= 0) {
                const data = {
                    documentid: dataset.documentid,
                    list: "system.bio",
                    bioIndex: idx,
                    type: "SortBioFields"
                };
                event.dataTransfer.setData("text/plain", JSON.stringify(data));
                return;
            }
            return;
        }

        // For all other drag operations (abilities), use parent implementation
        super._onDragStart(event);
    }

    async _onDrop(event) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

        // Handle different data types
        switch (data.type) {
            // Abilities category change - handled by parent class
            case 'Sort':                
                return super._onDrop(event);
            // Item position reordering - handled locally
            case 'SortOrder':                
                return this._onReorderItem(event, data);
            case "SortBioFields":
                return this._onReorderBioField(event, data);
            // Dropped Item from compendium/sidebar
            case 'Item':                
                return this._onDropItem(event, data);
        }
    }

    /**
     * @param {DragEvent} event
     * @param {{ documentid: string, list: string, bioIndex?: number, type: string }} data
     */
    async _onReorderBioField(event, data) {
        if (data.documentid !== this.item.id && data.documentid !== this.item._id) {
            this.#clearDragOverClasses();
            return;
        }
        await DropHelper.ReorderBioFields(this.item, event, data, {
            itemClass: ".bio-field-item",
            dropArea: "bio",
            sheet: this
        });
        this.#clearDragOverClasses();
    }

    #clearDragOverClasses() {
        this.element.querySelectorAll(".drag-over-top, .drag-over-bottom, .drag-over").forEach((el) => {
            el.classList.remove("drag-over-top", "drag-over-bottom", "drag-over");
        });
    }

    /**
     * Handle reordering of items within a list (advantages and features).
     * Uses the shared DropHelper.ReorderItemsInList() function.
     * @param {DragEvent} event - The drop event
     * @param {object} data - The drag data containing documentid, itemid, and list
     */
    async _onReorderItem(event, data) {
        // Validate this is the correct document
        if (data.documentid !== this.item._id) {
            // Clean up on early return
            this.element.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
            });
            return;
        }
        
        // Only handle items of correct type
        if (data.itemtype !== "Advantage" && data.itemtype !== "Trait" && data.itemtype !== "Sphere" && data.itemtype !== "Realm") {
            // Clean up on early return
            this.element.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
            });
            return;
        }

        let itemClass = "";

        if (data.itemtype === "Advantage") {
            itemClass = ".advantage-item";
        }
        else if ((data.itemtype === "Feature") || (data.itemtype === "Trait")) {
            itemClass = ".feature-item";
        }
        else if ((data.itemtype === "Sphere") || (data.itemtype === "Realm") || (data.itemtype === "Power")) {
            itemClass = ".power-item";
        }
        else {
            // Clean up on early return
            this.element.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
            });
            return;
        }

        let dropArea = data.itemtype.toLowerCase();
        dropArea = dropArea === "sphere" || dropArea === "realm" ? "powers" : dropArea;

        let orderProperty = "system.settings.order";
        orderProperty = data.itemtype === "Trait" ? 'system.order' : orderProperty;

        // Use the shared function from DropHelper
        await DropHelper.ReorderEmbeddedItemsInList(
            this.item,
            event,
            data,
            {
                itemClass: itemClass,
                dropArea: dropArea,
                orderProperty: orderProperty,
                sheet: this
            }
        );
        
        // Always clean up drag-over classes after reorder attempt
        this.element.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
        });
    } 

    /**
     * Override _onDragOver to provide visual feedback for drag-and-drop operations.
     * Handles advantage, feature, power reordering and ability category changes.
     * @param {DragEvent} event - The dragover event
     */
    _onDragOver(event) {
        // Remove previous hover classes from all draggable items
        this.element.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
        });

        // Item classes that support drag-over feedback
        const itemClasses = [".advantage-item", ".feature-item", ".power-item", ".ability-item", ".bio-field-item"];
        
        // Check for any item drop target
        for (const itemClass of itemClasses) {
            const target = event.target.closest(itemClass);
            if (target) {
                const rect = target.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (event.clientY < midpoint) {
                    target.classList.add('drag-over-top');
                } else {
                    target.classList.add('drag-over-bottom');
                }
                return;
            }
        }

        // Highlight ability category drop zone
        const abilityZone = event.target.closest('.ability-statArea[data-droparea]');
        if (abilityZone) {
            abilityZone.classList.add('drag-over');
        }
    }


    async _onDropItem(event, data) {
        await super._onDropItem(event, data);

        const droppedItem = await Item.implementation.fromDropData(data);  
        let update = false;      

        if (checkItemValues(droppedItem) === false) {
            return;
        }

        let itemCopy = droppedItem.toObject();
        itemCopy.uuid = droppedItem.uuid;
        const itemData = foundry.utils.duplicate(this.item);

        if (droppedItem.type === "Ability") {    
            if (droppedItem.system.type === "wod.abilities.ability") {
                droppedItem.system.type = "wod.abilities.talent";
            }

            itemData.system.abilities.push(itemCopy);
            update = true;
        }

        if (droppedItem.type === "Advantage") {
            itemCopy.system.settings.order = itemData.system.advantages.length;
            itemData.system.advantages.push(itemCopy);
            update = true;
        }

        if ((droppedItem.type === "Trait") && (droppedItem.system.type === "wod.types.shapeform")) {
            itemCopy.system.order = itemData.system.features.length;
            itemData.system.features.push(itemCopy);            
            update = true;
        }

        if ((droppedItem.type === "Sphere") || (droppedItem.type === "Realm") || (droppedItem.type === "Power")) {
            itemCopy.system.order = itemData.system.powers.length;
            itemData.system.powers.push(itemCopy);            
            update = true;
        }

        if (update) {
            await this.item.update(itemData);
            this.render();
        }
    }

    static async #onSplatBioToggleAdd(event, target) {
        event.preventDefault();
        const sheet = /** @type {SplatItemSheet} */ (this);
        if (sheet.locked) {
            ui.notifications.warn(game.i18n.localize("wod.system.sheetlocked"));
            return;
        }
        sheet.#bioAdding = !sheet.#bioAdding;
        if (sheet.#bioAdding) {
            sheet.#bioEditIndex = null;
        }
        await sheet.render();
    }

    static async #onSplatBioCancelAdd(event, target) {
        event.preventDefault();
        const sheet = /** @type {SplatItemSheet} */ (this);
        sheet.#bioAdding = false;
        const input = sheet.element?.querySelector("[data-splat-new-bio-key]");
        if (input) {
            input.value = "";
        }
        await sheet.render();
    }

    static async #onSplatBioConfirmAdd(event, target) {
        event.preventDefault();
        const sheet = /** @type {SplatItemSheet} */ (this);
        if (sheet.locked) {
            ui.notifications.warn(game.i18n.localize("wod.system.sheetlocked"));
            return;
        }
        const input = sheet.element.querySelector("[data-splat-new-bio-key]");
        const key = (input?.value ?? "").trim();
        if (!key) {
            ui.notifications.info(game.i18n.localize("wod.labels.splat.bioneedkey"));
            return;
        }
        if (key.includes(".") || /\s/.test(key)) {
            ui.notifications.warn(game.i18n.localize("wod.labels.splat.biokeyinvalid"));
            return;
        }
        const bio = foundry.utils.duplicate(DropHelper.splatBioTemplateArray(sheet.item));
        if (bio.some((e) => e?.key === key || e?.id === key)) {
            ui.notifications.warn(game.i18n.format(game.i18n.localize("wod.labels.splat.biokeyexists"), { key }));
            return;
        }
        bio.push({
            key,
            label: "",
            value: "",
            type: "input",
            listdata: ""
        });
        await sheet.item.update({ "system.bio": bio }, { diff: false });
        if (input) {
            input.value = "";
        }
        sheet.#bioAdding = false;
        sheet.#bioEditIndex = key === "generation" ? null : bio.length - 1;
        await sheet.render();
    }

    static async #onSplatBioToggleEdit(event, target) {
        event.preventDefault();
        const sheet = /** @type {SplatItemSheet} */ (this);
        if (sheet.locked) {
            ui.notifications.warn(game.i18n.localize("wod.system.sheetlocked"));
            return;
        }
        const idx = SplatItemSheet.#bioRowIndexFromTarget(target);
        if (idx < 0) return;
        const entry = DropHelper.splatBioTemplateArray(sheet.item)[idx];
        if (entry?.key === "generation") {
            return;
        }
        sheet.#bioEditIndex = sheet.#bioEditIndex === idx ? null : idx;
        sheet.#bioAdding = false;
        await sheet.render();
    }

    static async #onSplatBioRemoveField(event, target) {
        event.preventDefault();
        const sheet = /** @type {SplatItemSheet} */ (this);
        if (sheet.locked) {
            ui.notifications.warn(game.i18n.localize("wod.system.sheetlocked"));
            return;
        }
        const idx = SplatItemSheet.#bioRowIndexFromTarget(target);
        if (idx < 0) return;
        sheet.#bioEditIndex = null;
        const bio = foundry.utils.duplicate(DropHelper.splatBioTemplateArray(sheet.item));
        if (idx >= bio.length) return;
        bio.splice(idx, 1);
        await sheet.item.update({ "system.bio": bio }, { diff: false });
        await sheet.render();
    }
}

export const prepareStatContext = async function (context, item) {
    context.tab = context.tabs.stats;

    context.description = item.system.description;
    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description, {async: true});

    return context;
}

export const prepareBioContext = async function (context, item) {
    context.tab = context.tabs.bio;

    const bioArr = DropHelper.splatBioTemplateArray(item);
    context.bioFieldRows = bioArr.map((entry, index) => {
        const rawKey = typeof entry?.key === "string" ? entry.key : "";
        const rawId = typeof entry?.id === "string" ? entry.id : "";
        const key =
            rawKey ||
            rawId ||
            (typeof entry?.label === "string" && entry.label.includes(".")
                ? entry.label.split(".").pop()
                : "");
        const def = {
            label: entry?.label ?? "",
            value: entry?.value != null ? String(entry.value) : "",
            type: entry?.type || "input",
            listdata: entry?.listdata ?? ""
        };
        if (def.type === "select" && (def.listdata === undefined || def.listdata === null)) def.listdata = "";
        return {
            index,
            key,
            isReservedGeneration: rawKey === "generation",
            def
        };
    });

    context.bioTypeOptions = {
        input: game.i18n.localize("wod.labels.splat.biotypeinput"),
        select: game.i18n.localize("wod.labels.splat.biotypeselect"),
        textbox: game.i18n.localize("wod.labels.splat.biotypetextbox")
    };

    for (const row of context.bioFieldRows) {
        row.typeLabel = context.bioTypeOptions[row.def.type] ?? row.def.type;
        row.displayLabel = row.def.label ? game.i18n.localize(row.def.label) : "";
        const rawVal = row.def.value != null ? String(row.def.value) : "";
        row.displayValue = rawVal.length > 50 ? `${rawVal.slice(0, 47)}…` : rawVal;
    }

    return context;
}

export const prepareAbilitiesContext = async function (context, item) {
    context.tab = context.tabs.abilities;

    const filteredTalents = item.system.abilities.filter(ability => {
        return ability.system?.type === "wod.abilities.talent";
    });
    const filteredSkills = item.system.abilities.filter(ability => {
        return ability.system?.type === "wod.abilities.skill";
    });
    const filteredKnoweledges = item.system.abilities.filter(ability => {
        return ability.system?.type === "wod.abilities.knowledge";
    });

    context.talents = translateItem(filteredTalents);
    context.skills = translateItem(filteredSkills);
    context.knowledges = translateItem(filteredKnoweledges);

    return context;
}

export const prepareFeaturesContext = async function (context, item) {
    context.tab = context.tabs.features;

    context.advantages = translateItem(item.system.advantages);
    context.advantages.sort((a, b) => Number(a.system.settings.order) - Number(b.system.settings.order));

    context.features = translateItemOrder(item.system.features);

    context.powers = translateItemOrder(item.system.powers);

    return context;
}

function translateItemOrder(featureList) {
    if (!featureList) return [];
    
    const list = [];

    for (const item of featureList) {
        // For Trait items, use name if label is not set
        if (!item.system.label || item.system.label === "") {
            item.system.label = item.name;
        } else {
            item.system.label = game.i18n.localize(item.system.label);
        }
        list.push(item);
    }

    // Sort by order - check if system.settings.order exists first, otherwise use system.order
    list.sort((a, b) => {
        // Check if system.settings.order exists
        const hasSettingsOrderA = a.system.settings?.order !== undefined;
        const hasSettingsOrderB = b.system.settings?.order !== undefined;
        
        if (hasSettingsOrderA && hasSettingsOrderB) {
            // Both have system.settings.order - sort by that
            return Number(a.system.settings.order) - Number(b.system.settings.order);
        } else if (hasSettingsOrderA || hasSettingsOrderB) {
            // One has system.settings.order, one doesn't - prioritize the one with settings.order
            return hasSettingsOrderA ? -1 : 1;
        } else {
            // Neither has system.settings.order - use system.order
            const orderA = a.system.order !== undefined ? Number(a.system.order) : 999;
            const orderB = b.system.order !== undefined ? Number(b.system.order) : 999;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
        }
        // Fallback to alphabetical
        return a.system.label.localeCompare(b.system.label);
    });

    return list;
}

function translateItem(itemList) {
    const list = [];

    for (const item of itemList) {
        item.system.label = game.i18n.localize(item.system.label);

        list.push(item);
    }

    list.sort((a, b) => a.system.label.localeCompare(b.system.label));

    return list;
}

function checkItemValues(item) {
    let message = "";

    if ((item.system.id === "") || (item.system.label === "")) {
        message = "Dropped Item missing required information.";
    }

    if (message !== "") {
        console.warn(message);
        return false;
    }

    return true;    
}
