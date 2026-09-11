import { createApp } from 'vue';

const socket = io();
const feedback = {
    siteName: '', fugaraPairingCode: '', remoteTarget: '', folderTrackName: '', memoryLevel: '',
    localMemoryLevel: '', trackNum: '', trackTime: '', trackLocked: 0,
    transposer: '', sostActive: null, expressions: [], stops: [], userVars: [],
    trackDupSrc: '', trackDupTgt: '', udpTrackNames: {}, queriedFolderNames: {},
    numTracks: 900, numFolders: 100, numLevels: 9999, oscSpecialStatus: {}, userVarPage: ''
};

const app = createApp({
    data() {
        return {
            standaloneView: window.location?.pathname.match(/^\/console\/custom\/([^/]+)\/?$/)?.[1] || '',
            customViews: [], customError: '', customLoading: false, customDrafts: {}, customPending: {},
            activeTab: 'overview', trackSearch: '', tabs: [{id: 'overview', label: 'Overview'}, {id: 'memory', label: 'Memory'}, {id: 'tracks', label: 'Tracks'}, {id: 'expression', label: 'Expression'}, {id: 'probes', label: 'Probes'}, {id: 'settings', label: 'Settings'}],
            alertSettings: {enabled: false, dashboard: true, email: false, recovery: true, minutes: 240, source: 'organ'},
            alertStatus: {}, alertRecipients: '', alertMessage: '', alertLoaded: false, alertSaving: false, alertTimer: null,
            ...feedback, connected: false, probes: [], panel: 'transposer', sheet: '', commandStatus: '',
            localMemory: false, levelNumber: 1, selectedNumber: 1, renameText: '', tracksPane: 'tracks',
            panels: [{id: 'sostenuto', label: 'Sostenuto'},
                {id: 'transposer', label: 'Transposer'},
                {id: 'recorder', label: 'Record / playback'},
                {id: 'probes', label: 'Probes'}]
        };
    },
    computed: {
        visibleTabs() { return this.tabs.filter(tab => tab.id !== 'probes' || this.probes.length); },
        pageTitle() {
            return this.tabs.find(item => item.id === this.activeTab)?.label;
        },
        showTransport() { return this.activeTab === 'tracks'; },
        visibleCustomViews() { return this.customViews.filter(view => !this.standaloneView || view.id === this.standaloneView); },
        filteredTracks() {
            const query = this.trackSearch.trim().toLowerCase();
            return Array.from({length: this.numTracks}, (_, i) => ({number: i + 1, name: this.udpTrackNames[i + 1]})).filter(entry => !query || `${entry.number} ${entry.name || 'Unnamed track'}`.toLowerCase().includes(query));
        },
        liveProbeCount() { return this.connected ? this.probes.filter(probe => probe.online).length : 0; },
        probeSummary() { return !this.connected ? 'Disconnected' : this.probes.length ? `${this.liveProbeCount} / ${this.probes.length} live` : 'Waiting'; },
        shownMemory() { return this.localMemory ? this.localMemoryLevel : this.memoryLevel; },
        currentTrackName() { return this.udpTrackNames[this.trackNum] || ''; },
        transposeText() {
            if (this.transposer === '' || this.transposer == null) return '—';
            const value = Number(this.transposer);
            return Number.isFinite(value) ? (value === 0 ? 'Neutral' : value > 0 ? '+' + value : String(value)) : this.transposer;
        },
        namedExpressions() {
            return this.expressions.map((exp, id) => ({...exp, id, value: Math.max(0, Math.min(1, Number(exp?.value) || 0))})).filter(exp => exp.name);
        },
        namedUserVars() { return this.userVars.map((item, i) => ({...item, number: i + 1})).filter(item => item.name); },
        sheetTitle() { return {memory: 'Memory select', library: 'Organist folder', tracks: 'Tracks', copy: 'Copy track', probes: 'Probe readings', settings: 'Settings'}[this.sheet] || ''; },
        inventoryEntries() {
            const library = this.sheet === 'library';
            const names = library ? this.queriedFolderNames : this.udpTrackNames;
            return Array.from({length: library ? this.numFolders : this.numTracks}, (_, i) => ({number: i + 1, name: names[i + 1]}));
        }
    },
    methods: {
        showControl(id) {
            this.selectTab(id);
        },
        selectHashTab() {
            if (!this.standaloneView) this.selectTab(window.location?.hash.slice(1));
        },
        async loadCustomViews() {
            this.customLoading = true;
            this.customError = '';
            try {
                const response = await fetch('/api/console-controls', {cache: 'no-store'});
                const config = await response.json();
                if (!response.ok) throw new Error(config.error || 'Unable to load custom controls.');
                this.customViews = config.views;
                this.customDrafts = {};
                this.tabs = this.tabs.filter(tab => !tab.id.startsWith('custom-'));
                this.tabs.splice(this.tabs.length - 1, 0, ...config.views.map(view => ({id: 'custom-' + view.id, label: view.title})));
                if (this.standaloneView) {
                    this.activeTab = 'custom-' + this.standaloneView;
                    const view = config.views.find(view => view.id === this.standaloneView);
                    if (!view) throw new Error('This custom view is not configured.');
                    document.title = view.title + ' · OrganUI';
                } else {
                    const requested = window.location?.hash.slice(1);
                    if (requested && this.tabs.some(tab => tab.id === requested)) this.selectTab(requested);
                    else if (!this.tabs.some(tab => tab.id === this.activeTab)) this.activeTab = 'overview';
                }
            } catch (error) {
                this.customViews = [];
                this.tabs = this.tabs.filter(tab => !tab.id.startsWith('custom-'));
                if (!this.standaloneView && this.activeTab.startsWith('custom-')) this.activeTab = 'settings';
                this.customError = error.message;
            } finally { this.customLoading = false; }
        },
        customBinding(control) {
            return control.type === 'stop' ? {type: 'stop', number: control.number} : control.type === 'userVariable' ? {type: 'userVariable', number: control.number} : control.feedback;
        },
        customValue(control) {
            const binding = this.customBinding(control);
            if (!binding) return undefined;
            if (binding.type === 'stop') return this.stops.find(stop => Number(stop?.number) === binding.number)?.active;
            if (binding.type === 'userVariable') return this.userVars[binding.number - 1]?.value;
            if (binding.type === 'expression') return this.expressions[binding.number]?.value;
            if (binding.type === 'special') return this.oscSpecialStatus[binding.number];
            return this[binding.key];
        },
        customReadout(control) {
            const value = this.customValue(control);
            if (value === undefined || value === null || value === '') return 'Awaiting feedback';
            if (control.type === 'stop') return Number(value) ? 'On' : 'Off';
            return (control.valueLabels?.[String(value)] ?? String(value)) + (control.unit ? ' ' + control.unit : '');
        },
        customActive(control) {
            const value = this.customValue(control);
            return value !== undefined && value !== null && value !== '' && String(value) === String(control.activeValue ?? 1);
        },
        customInputValue(view, control) {
            const value = this.customDrafts[view.id + '/' + control.id] ?? this.customValue(control);
            return value ?? (control.type === 'range' ? control.min : '');
        },
        customSubstitute(value, input) {
            if (value === '$value') return input;
            if (Array.isArray(value)) return value.map(item => this.customSubstitute(item, input));
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.customSubstitute(item, input)]));
            return value;
        },
        async runCustom(view, control, input) {
            const key = view.id + '/' + control.id;
            if (!socket.connected || this.customPending[key]) return;
            if (control.type === 'stop') { this.udp('toggleStop', {number: control.number}); return; }
            if (control.type === 'userVariable') { this.pulse('/UserDef/' + (input === 'down' ? 'dec' : 'inc') + control.number); return; }
            if (control.type === 'select') {
                const option = control.options.find(option => String(option.value) === String(input));
                if (!option) return;
                input = option.value;
            }
            if (control.type === 'range') {
                input = Number(input);
                if (!Number.isFinite(input) || input < control.min || input > control.max) return;
            }
            const action = this.customSubstitute(control.action, input);
            if (!action) return;
            if (['select', 'range'].includes(control.type) && !control.feedback) this.customDrafts[key] = input;
            if (action.type === 'udp') { this.udp(action.command.action, action.command); return; }
            if (action.type === 'osc' && action.mode !== 'send') { this.pulse(action.cmd); return; }
            this.customPending[key] = true;
            this.commandStatus = 'Sending…';
            try {
                const method = action.type === 'osc' ? 'POST' : action.method || 'POST';
                const body = action.type === 'osc' ? {cmd: action.cmd, state: action.value} : action.body;
                const response = await fetch(action.type === 'osc' ? '/api/osc' : action.path, {
                    method, headers: {'Content-Type': 'application/json'},
                    ...(method !== 'GET' && body !== undefined ? {body: JSON.stringify(body)} : {}),
                    signal: AbortSignal.timeout(5000)
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || result.ok === false) throw new Error(result.error || result.message || `Command failed (${response.status})`);
                this.commandStatus = 'Command sent';
            } catch (error) {
                delete this.customDrafts[key];
                this.commandStatus = error.name === 'TimeoutError' ? 'No server acknowledgement · check console before retrying' : error.message;
            } finally { this.customPending[key] = false; }
        },
        selectTab(id) {
            if (id === 'controls') id = 'memory';
            if (!this.visibleTabs.some(tab => tab.id === id)) return;
            if (id === 'memory' && this.activeTab !== id) this.levelNumber = Number(this.shownMemory) || 1;
            if (id === 'tracks' && this.activeTab !== id) { this.selectedNumber = Number(this.trackNum) || 1; this.renameText = ''; }
            this.activeTab = id;
            if (id === 'settings') this.getAlertStatus();
        },
        tabKeydown(event, id) {
            const index = this.visibleTabs.findIndex(tab => tab.id === id);
            const next = {ArrowRight: (index + 1) % this.visibleTabs.length, ArrowLeft: (index + this.visibleTabs.length - 1) % this.visibleTabs.length, Home: 0, End: this.visibleTabs.length - 1}[event.key];
            if (next === undefined) return;
            event.preventDefault();
            this.selectTab(this.visibleTabs[next].id);
            event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
        },
        async getAlertStatus(initial = false) {
                    try {
                        const response = await fetch('/api/left-on-alerts');
                        if (!response.ok) throw new Error('Unable to load organ alert status.');
                        this.alertStatus = await response.json();
                        if (initial || !this.alertLoaded) {
                            this.alertSettings = { ...this.alertStatus.settings };
                            this.alertRecipients = this.alertSettings.recipients.join(', ');
                            this.alertLoaded = true;
                        }
                    } catch (error) { this.alertMessage = error.message; }
                },
                async saveAlertSettings() {
                    this.alertSaving = true;
                    try {
                        const response = await fetch('/api/left-on-alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...this.alertSettings, recipients: this.alertRecipients.split(',').map(value => value.trim()).filter(Boolean) }) });
                        const payload = await response.json();
                        if (!response.ok) throw new Error(payload.message || 'Unable to save alert settings.');
                        this.alertStatus = payload;
                        this.alertMessage = 'Alert settings saved.';
                    } catch (error) { this.alertMessage = error.message; }
                    finally { this.alertSaving = false; }
                },

        probeStatus(probe) { return !this.connected ? 'Disconnected' : probe.online ? 'Live' : 'Stale'; },
        probeTypeLabel(probe) { return {environment: 'Environment', power: 'Power', pressure: 'Wind pressure'}[probe.probeType] || 'Probe'; },
        probeNumber(value, digits = 1) {
            return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(digits);
        },
        probeMeasurements(probe) {
            if (probe.probeType === 'environment') return [
                {label: 'Temperature', value: `${this.probeNumber(probe.temperature)}° ${probe.temperatureUnit || ''}`},
                {label: 'Humidity', value: `${this.probeNumber(probe.humidity)}% RH`}
            ];
            if (probe.probeType === 'power') return [
                {label: 'RMS current', value: `${this.probeNumber(probe.currentAmps, 2)} A`},
                {label: 'Estimated load', value: Number(probe.estimatedWatts) >= 1000 ? `${this.probeNumber(probe.estimatedWatts / 1000, 2)} kW` : `${this.probeNumber(probe.estimatedWatts, 0)} W`}
            ];
            const millimeters = probe.displayPressureUnit === 'mmH2O';
            const pressure = probe.pressureInH2O;
            return [{label: 'Wind pressure', value: `${this.probeNumber(pressure == null || pressure === '' ? null : Number(pressure) * (millimeters ? 25.4 : 1), millimeters ? 1 : 2)} ${millimeters ? 'mmH2O' : 'inH2O'}`}];
        },
        probeTime(value) {
            const date = value ? new Date(value) : null;
            return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not received';
        },
        panelSummary(id) {
            return {sostenuto: this.sostActive === null ? '—' : this.sostActive ? 'On' : 'Off',
                transposer: this.transposeText,
                recorder: this.currentTrackName || (this.trackNum ? 'Track ' + this.trackNum : '—'), probes: this.probeSummary}[id];
        },
        udp(action, values = {}) {
            if (!socket.connected) { this.commandStatus = 'Disconnected · command not sent'; return; }
            this.commandStatus = 'Sending…';
            socket.timeout(5000).emit('sendUDPcmd', {action, ...values}, (error, result) => {
                this.commandStatus = error ? 'No server acknowledgement · check console before retrying' : result?.ok ? 'Command sent' : result?.error || 'Command not accepted';
            });
        },
        pulse(cmd) {
            if (!socket.connected) { this.commandStatus = 'Disconnected · command not sent'; return; }
            socket.emit('sendOSCcmd', {cmd, state: 1});
            window.setTimeout(() => { if (socket.connected) socket.emit('sendOSCcmd', {cmd, state: 0}); }, 80);
            this.commandStatus = 'Command sent';
        },
        tap(number) { this.pulse('/OPTICS/special' + number); },
        changeMemory(direction) { this.udp((this.localMemory ? 'localMemoryLevel' : 'memoryLevel') + direction); },
        moveFader(id, value) {
            if (!socket.connected) return;
            const normalized = Math.max(0, Math.min(1, Number(value)));
            if (!Number.isFinite(normalized)) return;
            socket.emit('moveFader', {id, value: normalized});
            this.expressions[id].value = normalized;
        },
        openSheet(name) {
            if (['tracks', 'probes', 'settings'].includes(name)) { this.selectTab(name); return; }
            this.sheet = name;
            this.renameText = '';
            if (name === 'memory') this.levelNumber = Number(this.shownMemory) || 1;
            if (name === 'tracks') this.selectedNumber = Number(this.trackNum) || 1;
            if (name === 'library') this.selectedNumber = 1;
            this.$refs.sheet.showModal();
        },
        closeSheet() { this.$refs.sheet.close(); },
        closeOnBackdrop(event) { if (event.target === this.$refs.sheet) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeSheet(); } },
        goMemory() { this.udp(this.localMemory ? 'gotoLocalLevel' : 'gotoLevel', {number: this.levelNumber}); },
        chooseItem() { this.udp(this.sheet === 'library' ? 'gotoFolder' : 'playTrack', {number: this.selectedNumber}); },
        renameItem() { this.udp(this.sheet === 'library' ? 'renameFolder' : 'renameTrack', {number: this.selectedNumber, name: this.renameText}); },
        refreshNames() {
            if (!socket.connected) return;
            socket.timeout(5000).emit('refreshNameInventory', (error, result) => {
                this.commandStatus = error ? 'Name refresh timed out' : result?.ok ? 'Reading names from console' : result?.error || 'Could not refresh names';
            });
        },
    },
    mounted() {
        if (this.standaloneView) this.activeTab = 'custom-' + this.standaloneView;
        else this.selectHashTab();
        window.addEventListener('hashchange', this.selectHashTab);
        this.loadCustomViews();
        this.alertTimer = window.setInterval(() => { if (this.activeTab === 'settings') this.getAlertStatus(); }, 15000);
    },
    beforeUnmount() { window.removeEventListener('hashchange', this.selectHashTab); window.clearInterval(this.alertTimer); }
}).mount('#app');

for (const name of Object.keys(feedback)) socket.on(name, value => { app[name] = value; });
socket.on('probeReadings', readings => {
    app.probes = Array.isArray(readings) ? readings : [];
    if (!app.probes.length && app.activeTab === 'probes') app.selectTab('overview');
});
socket.on('remoteReply', value => { app.commandStatus = value; });
socket.on('connect', () => { app.connected = true; app.commandStatus = ''; });
socket.on('disconnect', () => { app.connected = false; app.commandStatus = 'Connection lost'; });
socket.on('connect_error', () => { app.connected = false; app.commandStatus = 'Unable to connect to server'; });
