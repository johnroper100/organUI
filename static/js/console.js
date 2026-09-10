import { createApp } from 'vue';

const socket = io();
const feedback = {
    siteName: '', fugaraPairingCode: '', remoteTarget: '', folderTrackName: '', memoryLevel: '',
    localMemoryLevel: '', trackNum: '', trackTime: '', trackLocked: 0,
    transposer: '', sostActive: null, expressions: [], stops: [], userVars: [],
    trackDupSrc: '', trackDupTgt: '', udpTrackNames: {}, queriedFolderNames: {},
    numTracks: 900, numFolders: 100, numLevels: 9999
};

const app = createApp({
    data() {
        return {
            ...feedback, connected: false, probes: [], panel: 'timer', sheet: '', commandStatus: '',
            localMemory: false, levelNumber: 1, selectedNumber: 1, renameText: '', stopSearch: '',
            timerElapsed: 0, timerStarted: null, now: Date.now(), timerInterval: null,
            panels: [{id: 'sostenuto', label: 'Sostenuto'}, {id: 'crescendo', label: 'Crescendo'},
                {id: 'timer', label: 'Timer'}, {id: 'transposer', label: 'Transposer'},
                {id: 'stops', label: 'Stops & couplers'}, {id: 'recorder', label: 'Recorder'},
                {id: 'probes', label: 'Probes'}]
        };
    },
    computed: {
        liveProbeCount() { return this.connected ? this.probes.filter(probe => probe.online).length : 0; },
        probeSummary() { return !this.connected ? 'Disconnected' : this.probes.length ? `${this.liveProbeCount} / ${this.probes.length} live` : 'Waiting'; },
        shownMemory() { return this.localMemory ? this.localMemoryLevel : this.memoryLevel; },
        currentTrackName() { return this.udpTrackNames[this.trackNum] || ''; },
        transposeText() {
            if (this.transposer === '' || this.transposer == null) return '—';
            const value = Number(this.transposer);
            return Number.isFinite(value) ? (value === 0 ? 'Off' : value > 0 ? '+' + value : String(value)) : this.transposer;
        },
        namedExpressions() {
            return this.expressions.map((exp, id) => ({...exp, id, value: Math.max(0, Math.min(1, Number(exp?.value) || 0))})).filter(exp => exp.name);
        },
        crescendoExpression() { return this.namedExpressions.find(exp => /cres/i.test(exp.name)); },
        crescendoStops() { return this.stops.filter(stop => stop?.name && /crescendo|\bcresc?\b/i.test(stop.name)); },
        activeStopCount() { return this.stops.filter(stop => stop?.active).length; },
        filteredStops() { return this.stops.filter(stop => stop?.name && stop.name.toLowerCase().includes(this.stopSearch.toLowerCase())); },
        namedUserVars() { return this.userVars.map((item, i) => ({...item, number: i + 1})).filter(item => item.name); },
        timerText() {
            const seconds = Math.floor((this.timerElapsed + (this.timerStarted === null ? 0 : this.now - this.timerStarted)) / 1000);
            return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
        },
        sheetTitle() { return {memory: 'Memory select', library: 'Library select', tracks: 'Recordings', copy: 'Copy recording', stops: 'Stops & couplers', probes: 'Probe readings', settings: 'Settings'}[this.sheet] || ''; },
        inventoryEntries() {
            const library = this.sheet === 'library';
            const names = library ? this.queriedFolderNames : this.udpTrackNames;
            return Array.from({length: library ? this.numFolders : this.numTracks}, (_, i) => ({number: i + 1, name: names[i + 1]}));
        }
    },
    methods: {
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
                crescendo: this.crescendoExpression ? Math.round(this.crescendoExpression.value * 100) + '%' : '—',
                timer: this.timerText, transposer: this.transposeText, stops: this.activeStopCount + ' active',
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
            this.sheet = name;
            this.renameText = '';
            if (name === 'memory') this.levelNumber = Number(this.shownMemory) || 1;
            if (name === 'tracks') this.selectedNumber = Number(this.trackNum) || 1;
            if (name === 'library') this.selectedNumber = 1;
            this.$refs.sheet.showModal();
        },
        closeSheet() { this.$refs.sheet.close(); },
        closeOnBackdrop(event) { if (event.target === this.$refs.sheet) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeSheet(); } },
        keypad(key) {
            const current = String(this.levelNumber || '');
            if (key === 'Clear') this.levelNumber = '';
            else if (key === '⌫') this.levelNumber = current.slice(0, -1);
            else this.levelNumber = Number((current + key).slice(0, String(this.numLevels).length));
        },
        goMemory() { this.udp(this.localMemory ? 'gotoLocalLevel' : 'gotoLevel', {number: this.levelNumber}); },
        chooseItem() { this.udp(this.sheet === 'library' ? 'gotoFolder' : 'playTrack', {number: this.selectedNumber}); },
        renameItem() { this.udp(this.sheet === 'library' ? 'renameFolder' : 'renameTrack', {number: this.selectedNumber, name: this.renameText}); },
        refreshNames() {
            if (!socket.connected) return;
            socket.timeout(5000).emit('refreshNameInventory', (error, result) => {
                this.commandStatus = error ? 'Name refresh timed out' : result?.ok ? 'Reading names from console' : result?.error || 'Could not refresh names';
            });
        },
        startTimer() { if (this.timerStarted === null) { this.now = Date.now(); this.timerStarted = this.now; } },
        stopTimer() { if (this.timerStarted !== null) { this.timerElapsed += Date.now() - this.timerStarted; this.timerStarted = null; } },
        resetTimer() { this.timerStarted = null; this.timerElapsed = 0; }
    },
    mounted() { this.timerInterval = window.setInterval(() => { this.now = Date.now(); }, 200); },
    beforeUnmount() { window.clearInterval(this.timerInterval); }
}).mount('#app');

for (const name of Object.keys(feedback)) socket.on(name, value => { app[name] = value; });
socket.on('probeReadings', readings => { app.probes = Array.isArray(readings) ? readings : []; });
socket.on('remoteReply', value => { app.commandStatus = value; });
socket.on('connect', () => { app.connected = true; app.commandStatus = ''; });
socket.on('disconnect', () => { app.connected = false; app.commandStatus = 'Connection lost'; });
socket.on('connect_error', () => { app.connected = false; app.commandStatus = 'Unable to connect to server'; });
