// Firebase設定
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCRWWrJyQm6x9b8DkgA9jkQWgLxRENotAg",
    authDomain: "block-blast-653e1.firebaseapp.com",
    projectId: "block-blast-653e1",
    databaseURL: "https://block-blast-653e1-default-rtdb.asia-southeast1.firebasedatabase.app"
};

class CloudSync {
    constructor() { this.user = null; this.db = null; this.initialized = false; }
    async init() {
        if (typeof firebase === 'undefined') return false;
        try {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            this.db = firebase.database();
            this.initialized = true;
            firebase.auth().onAuthStateChanged(user => {
                this.user = user;
                document.getElementById('loginBtn').textContent = user ? 'ログアウト' : 'Googleログイン';
                document.getElementById('loginStatus').textContent = user ? (user.email || 'ログイン中') : '未ログイン';
                document.getElementById('loginStatus').style.color = user ? '#1dd1a1' : '#aaa';
                if (user && window.multiAI) multiAI.loadFromCloud();
            });
            return true;
        } catch (e) { return false; }
    }
    async login() {
        if (!this.initialized) return;
        if (this.user) await firebase.auth().signOut();
        else await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }
    async save(data) { if (this.user && this.db) await this.db.ref(`users/${this.user.uid}/aiData`).set(data); }
    async load() {
        if (!this.user || !this.db) return null;
        return (await this.db.ref(`users/${this.user.uid}/aiData`).once('value')).val();
    }
}
const cloudSync = new CloudSync();

// 強化学習AIエージェント - 2手先読み
class AIAgent {
    constructor(id, game) {
        this.id = id;
        this.game = game;
        this.weights = this.randomWeights();
        this.gamesPlayed = 0;
        this.totalScore = 0;
        this.bestScore = 0;
    }

    randomWeights() {
        return {
            linesClear: 200 + Math.random() * 100,
            multiLine: 100 + Math.random() * 50,      // 複数ライン同時消しボーナス
            almostLine7: 40 + Math.random() * 20,     // あと1マス
            almostLine6: 20 + Math.random() * 10,     // あと2マス
            almostLine5: 8 + Math.random() * 4,       // あと3マス
            emptyBonus: 1.5 + Math.random() * 0.5,
            holePenalty: -25 - Math.random() * 15,
            hole4Penalty: -80 - Math.random() * 40,   // 完全に囲まれた穴
            edgeBonus: 3 + Math.random() * 2,
            cornerBonus: 6 + Math.random() * 4,
            bigPiece: 2 + Math.random() * 1,
            futureBonus: 0.5 + Math.random() * 0.3,
            rowColBalance: 5 + Math.random() * 3,     // 行列バランス
            centerPenalty: -1 - Math.random() * 0.5   // 中央配置ペナルティ
        };
    }

    get avgScore() { return this.gamesPlayed > 0 ? Math.round(this.totalScore / this.gamesPlayed) : 0; }
    copyFrom(w) { this.weights = { ...w }; }
    
    mutate(rate = 0.35, amount = 0.2) {
        for (const k in this.weights) {
            if (Math.random() < rate) {
                this.weights[k] *= (1 + (Math.random() - 0.5) * amount * 2);
            }
        }
    }

    canPlace(board, piece, px, py) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) {
                    const bx = px + x, by = py + y;
                    if (bx < 0 || bx >= BOARD_SIZE || by < 0 || by >= BOARD_SIZE) return false;
                    if (board[by][bx] !== 0) return false;
                }
            }
        }
        return true;
    }

    simulate(board, piece, px, py) {
        const newBoard = board.map(r => [...r]);
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) newBoard[py + y][px + x] = piece.color;
            }
        }
        let lines = 0;
        const S = BOARD_SIZE;
        for (let y = 0; y < S; y++) {
            if (newBoard[y].every(c => c !== 0)) {
                for (let x = 0; x < S; x++) newBoard[y][x] = 0;
                lines++;
            }
        }
        for (let x = 0; x < S; x++) {
            let full = true;
            for (let y = 0; y < S; y++) if (newBoard[y][x] === 0) { full = false; break; }
            if (full) {
                for (let y = 0; y < S; y++) newBoard[y][x] = 0;
                lines++;
            }
        }
        return { board: newBoard, lines };
    }

    evaluateBoard(board) {
        let score = 0;
        const S = BOARD_SIZE;

        // 空きマス
        let empty = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (board[y][x] === 0) empty++;
        score += this.weights.emptyBonus * empty;

        // 行・列の充填度
        let rowFills = [], colFills = [];
        for (let y = 0; y < S; y++) {
            const filled = board[y].filter(c => c !== 0).length;
            rowFills.push(filled);
            if (filled === S - 1) score += this.weights.almostLine7;
            else if (filled === S - 2) score += this.weights.almostLine6;
            else if (filled === S - 3) score += this.weights.almostLine5;
        }
        for (let x = 0; x < S; x++) {
            let filled = 0;
            for (let y = 0; y < S; y++) if (board[y][x] !== 0) filled++;
            colFills.push(filled);
            if (filled === S - 1) score += this.weights.almostLine7;
            else if (filled === S - 2) score += this.weights.almostLine6;
            else if (filled === S - 3) score += this.weights.almostLine5;
        }

        // 行列バランス（均等に埋める）
        const rowAvg = rowFills.reduce((a, b) => a + b, 0) / S;
        const colAvg = colFills.reduce((a, b) => a + b, 0) / S;
        const rowVar = rowFills.reduce((a, b) => a + Math.abs(b - rowAvg), 0) / S;
        const colVar = colFills.reduce((a, b) => a + Math.abs(b - colAvg), 0) / S;
        score -= (rowVar + colVar) * this.weights.rowColBalance * 0.1;

        // 穴ペナルティ
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (board[y][x] === 0) {
                    let walls = 0;
                    if (y === 0 || board[y-1][x] !== 0) walls++;
                    if (y === S-1 || board[y+1][x] !== 0) walls++;
                    if (x === 0 || board[y][x-1] !== 0) walls++;
                    if (x === S-1 || board[y][x+1] !== 0) walls++;
                    if (walls === 4) score += this.weights.hole4Penalty;
                    else if (walls === 3) score += this.weights.holePenalty;
                }
            }
        }

        // 端・角ボーナス
        for (let i = 0; i < S; i++) {
            if (board[i][0] !== 0) score += this.weights.edgeBonus;
            if (board[i][S-1] !== 0) score += this.weights.edgeBonus;
            if (board[0][i] !== 0) score += this.weights.edgeBonus;
            if (board[S-1][i] !== 0) score += this.weights.edgeBonus;
        }
        if (board[0][0] !== 0) score += this.weights.cornerBonus;
        if (board[0][S-1] !== 0) score += this.weights.cornerBonus;
        if (board[S-1][0] !== 0) score += this.weights.cornerBonus;
        if (board[S-1][S-1] !== 0) score += this.weights.cornerBonus;

        // 中央ペナルティ（端から埋める戦略）
        const center = Math.floor(S / 2);
        for (let y = center - 1; y <= center; y++) {
            for (let x = center - 1; x <= center; x++) {
                if (board[y][x] !== 0) score += this.weights.centerPenalty;
            }
        }

        return score;
    }

    countValidMoves(board, pieces) {
        let count = 0;
        for (const p of pieces) {
            if (p.used) continue;
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    if (this.canPlace(board, p, x, y)) count++;
                }
            }
        }
        return count;
    }

    // 2手先読み
    findBestMove() {
        const validMoves = this.game.getValidMoves();
        if (validMoves.length === 0) return null;

        let best = null, bestScore = -Infinity;
        const pieces = this.game.pieces;

        for (const m of validMoves) {
            const piece = pieces[m.pieceIndex];
            const result = this.simulate(this.game.board, piece, m.x, m.y);
            
            // 1手目の評価
            let moveScore = result.lines * this.weights.linesClear;
            if (result.lines >= 2) moveScore += result.lines * this.weights.multiLine;
            moveScore += this.evaluateBoard(result.board);
            moveScore += piece.shape.flat().filter(c => c).length * this.weights.bigPiece;

            // 残りピースでの配置可能数
            const remaining = pieces.map((p, i) => i === m.pieceIndex ? { ...p, used: true } : p);
            const futureMoves = this.countValidMoves(result.board, remaining);
            moveScore += futureMoves * this.weights.futureBonus;

            // 2手目先読み（残りピースで最良の手を探す）
            let bestSecond = 0;
            for (let i = 0; i < pieces.length; i++) {
                if (i === m.pieceIndex || pieces[i].used) continue;
                const p2 = pieces[i];
                for (let y = 0; y < BOARD_SIZE; y++) {
                    for (let x = 0; x < BOARD_SIZE; x++) {
                        if (this.canPlace(result.board, p2, x, y)) {
                            const r2 = this.simulate(result.board, p2, x, y);
                            let s2 = r2.lines * this.weights.linesClear * 0.5;
                            if (r2.lines >= 2) s2 += r2.lines * this.weights.multiLine * 0.5;
                            s2 += this.evaluateBoard(r2.board) * 0.3;
                            if (s2 > bestSecond) bestSecond = s2;
                        }
                    }
                }
            }
            moveScore += bestSecond;

            if (moveScore > bestScore) {
                bestScore = moveScore;
                best = m;
            }
        }
        return best;
    }

    step() {
        if (this.game.gameOver) return false;
        const move = this.findBestMove();
        if (move) {
            this.game.placePiece(move.pieceIndex, move.x, move.y);
            return true;
        }
        return false;
    }

    onGameOver() {
        this.gamesPlayed++;
        this.totalScore += this.game.score;
        if (this.game.score > this.bestScore) this.bestScore = this.game.score;
    }
}

// 高解像度グラフ
class StatsGraph {
    constructor() {
        this.canvas = document.getElementById('graphCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.resize();
        this.data = { scores: [], avgScores: [], maxScores: [], timestamps: [] };
        this.viewMode = 'recent';
        this.setupUI();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);
        this.W = rect.width;
        this.H = rect.height;
        this.draw();
    }

    setupUI() {
        document.getElementById('graphRecent').addEventListener('click', () => this.setView('recent'));
        document.getElementById('graphAll').addEventListener('click', () => this.setView('all'));
        document.getElementById('graphDaily').addEventListener('click', () => this.setView('daily'));
    }

    setView(mode) {
        this.viewMode = mode;
        document.querySelectorAll('.graph-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('graph' + mode.charAt(0).toUpperCase() + mode.slice(1)).classList.add('active');
        this.draw();
    }

    addScore(score, timestamp = Date.now()) {
        this.data.scores.push(score);
        this.data.timestamps.push(timestamp);
        const recent = this.data.scores.slice(-30);
        this.data.avgScores.push(Math.round(recent.reduce((a, b) => a + b, 0) / recent.length));
        const curMax = this.data.maxScores.length > 0 ? this.data.maxScores[this.data.maxScores.length - 1] : 0;
        this.data.maxScores.push(Math.max(curMax, score));
        if (this.data.scores.length % 3 === 0) this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const W = this.W, H = this.H;
        
        // 背景
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, W, H);

        let scores, avgScores, maxScores, labels;
        if (this.viewMode === 'daily') {
            const d = this.getDailyData();
            scores = d.scores; avgScores = d.avgs; maxScores = d.maxes; labels = d.labels;
        } else if (this.viewMode === 'recent') {
            const n = Math.min(150, this.data.scores.length);
            scores = this.data.scores.slice(-n);
            avgScores = this.data.avgScores.slice(-n);
            maxScores = this.data.maxScores.slice(-n);
        } else {
            scores = this.data.scores;
            avgScores = this.data.avgScores;
            maxScores = this.data.maxScores;
        }

        if (scores.length < 2) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データ収集中...', W / 2, H / 2);
            return;
        }

        const allVals = [...scores, ...avgScores, ...maxScores];
        const maxVal = Math.max(...allVals, 100) * 1.1;
        const pad = { top: 25, right: 15, bottom: 25, left: 45 };
        const gW = W - pad.left - pad.right;
        const gH = H - pad.top - pad.bottom;

        // グリッド
        ctx.strokeStyle = '#1a1a3e';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (gH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(W - pad.right, y);
            ctx.stroke();
            ctx.fillStyle = '#888';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 5, y + 4);
        }

        const drawLine = (data, color, width = 2, alpha = 1) => {
            if (data.length < 2) return;
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            data.forEach((v, i) => {
                const x = pad.left + (i / (data.length - 1)) * gW;
                const y = pad.top + gH - (v / maxVal) * gH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        drawLine(scores, '#48dbfb', 1, 0.2);
        drawLine(avgScores, '#feca57', 2.5);
        drawLine(maxScores, '#ff6b6b', 2.5);

        // 凡例
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(W - 120, 8, 12, 12);
        ctx.fillText('最高', W - 105, 18);
        ctx.fillStyle = '#feca57';
        ctx.fillRect(W - 65, 8, 12, 12);
        ctx.fillText('平均', W - 50, 18);

        // 現在値
        if (avgScores.length > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`現在平均: ${avgScores[avgScores.length - 1]}`, W - 15, H - 5);
        }

        // 日別ラベル
        if (labels && labels.length > 0) {
            ctx.fillStyle = '#666';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            const step = Math.max(1, Math.ceil(labels.length / 8));
            labels.forEach((l, i) => {
                if (i % step === 0) {
                    const x = pad.left + (i / (labels.length - 1)) * gW;
                    ctx.fillText(l, x, H - 5);
                }
            });
        }
    }

    getDailyData() {
        const daily = {};
        this.data.scores.forEach((s, i) => {
            const date = new Date(this.data.timestamps[i]).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
            if (!daily[date]) daily[date] = [];
            daily[date].push(s);
        });
        const labels = Object.keys(daily);
        const scores = labels.map(d => Math.round(daily[d].reduce((a, b) => a + b, 0) / daily[d].length));
        const maxes = labels.map(d => Math.max(...daily[d]));
        return { labels, scores, avgs: scores, maxes };
    }

    loadData(d) { if (d) { this.data = d; this.draw(); } }
    getData() { return this.data; }
}

// マルチエージェント管理
class MultiAgentAI {
    constructor() {
        this.container = document.getElementById('gamesContainer');
        this.agents = [];
        this.games = [];
        this.agentCount = 6;
        this.isRunning = false;
        this.speed = 20;
        this.generation = 1;
        this.totalGames = 0;
        this.bestScore = 0;
        this.bestWeights = null;
        this.graph = new StatsGraph();

        this.loadData();
        this.createAgents();
        this.setupUI();
        this.updateStats();
        cloudSync.init();
    }

    createAgents() {
        this.games.forEach(g => g.destroy());
        this.games = [];
        this.agents = [];

        for (let i = 0; i < this.agentCount; i++) {
            const game = new BlockBlastGame(this.container, i, false);
            this.games.push(game);
            
            const agent = new AIAgent(i, game);
            if (this.bestWeights) {
                agent.copyFrom(this.bestWeights);
                if (i > 0) agent.mutate(0.4, 0.25); // 最初の1体はベストそのまま
            }
            this.agents.push(agent);
        }
    }

    loadData() {
        const saved = localStorage.getItem('blockBlastAI_v6');
        if (saved) {
            const data = JSON.parse(saved);
            this.generation = data.generation || 1;
            this.totalGames = data.totalGames || 0;
            this.bestScore = data.bestScore || 0;
            this.bestWeights = data.bestWeights || null;
            if (data.graphData) this.graph.loadData(data.graphData);
        }
    }

    saveData() {
        const data = {
            generation: this.generation,
            totalGames: this.totalGames,
            bestScore: this.bestScore,
            bestWeights: this.bestWeights,
            graphData: this.graph.getData()
        };
        localStorage.setItem('blockBlastAI_v6', JSON.stringify(data));
        if (cloudSync.user) cloudSync.save(data);
    }

    async loadFromCloud() {
        const data = await cloudSync.load();
        if (data && data.bestScore > this.bestScore) {
            Object.assign(this, { generation: data.generation, totalGames: data.totalGames, bestScore: data.bestScore, bestWeights: data.bestWeights });
            if (data.graphData) this.graph.loadData(data.graphData);
            this.updateStats();
        }
    }

    setupUI() {
        document.getElementById('toggleAI').addEventListener('click', () => {
            this.isRunning = !this.isRunning;
            document.getElementById('toggleAI').textContent = this.isRunning ? 'AI停止' : 'AI開始';
            document.getElementById('toggleAI').classList.toggle('active', this.isRunning);
            if (this.isRunning) this.run();
        });

        document.getElementById('aiSpeed').addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            document.getElementById('speedValue').textContent = this.speed + 'ms';
        });

        document.getElementById('agentCount').addEventListener('change', (e) => {
            this.agentCount = parseInt(e.target.value);
            this.createAgents();
        });

        document.getElementById('loginBtn').addEventListener('click', () => cloudSync.login());
    }

    updateStats() {
        document.getElementById('generation').textContent = this.generation;
        document.getElementById('totalGames').textContent = this.totalGames;
        document.getElementById('bestScore').textContent = this.bestScore;
        
        const gd = this.graph.data;
        const recent = gd.avgScores.slice(-30);
        const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
        document.getElementById('avgScore').textContent = avg;

        const older = gd.avgScores.slice(-60, -30);
        if (older.length >= 10 && recent.length >= 10) {
            const oldAvg = older.reduce((a, b) => a + b, 0) / older.length;
            const newAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const growth = oldAvg > 0 ? ((newAvg - oldAvg) / oldAvg * 100).toFixed(1) : 0;
            document.getElementById('growth').textContent = (growth >= 0 ? '+' : '') + growth + '%';
            document.getElementById('growth').style.color = growth >= 0 ? '#1dd1a1' : '#ff6b6b';
        }
    }

    onAgentGameOver(idx) {
        const agent = this.agents[idx];
        const score = this.games[idx].score;
        
        agent.onGameOver();
        this.totalGames++;
        this.graph.addScore(score);

        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestWeights = { ...agent.weights };
            console.log(`🏆 New best: ${score} by AI ${idx + 1}`, agent.weights);
            this.games[idx].element.style.boxShadow = '0 0 30px #feca57';
            setTimeout(() => this.games[idx].element.style.boxShadow = '', 2000);
        }

        // 進化
        const minGames = Math.min(...this.agents.map(a => a.gamesPlayed));
        if (minGames > 0 && minGames % 3 === 0) this.evolve();

        this.games[idx].init();
        if (this.totalGames % 15 === 0) { this.saveData(); this.updateStats(); }
    }

    evolve() {
        const ranked = this.agents.map((a, i) => ({ agent: a, idx: i, avg: a.avgScore })).sort((a, b) => b.avg - a.avg);
        console.log(`📊 Gen ${this.generation}:`, ranked.slice(0, 5).map(r => r.avg).join(', '));

        const elite = Math.max(1, Math.floor(this.agents.length * 0.2)); // 上位20%
        const survivors = Math.max(2, Math.ceil(this.agents.length * 0.5)); // 上位50%

        for (let i = elite; i < this.agents.length; i++) {
            const target = this.agents[ranked[i].idx];
            
            if (i < survivors) {
                // 上位50%: 軽い変異のみ
                target.mutate(0.2, 0.15);
            } else {
                // 下位50%: 上位からコピー+変異
                const parentIdx = i % elite;
                target.copyFrom(ranked[parentIdx].agent.weights);
                target.mutate(0.5, 0.3);
            }
            target.gamesPlayed = 0;
            target.totalScore = 0;
        }

        // ベストの遺伝子を全体に少し注入
        if (this.bestWeights) {
            this.agents.forEach((a, i) => {
                if (i >= elite) {
                    for (const k in a.weights) {
                        if (Math.random() < 0.15) a.weights[k] = this.bestWeights[k];
                    }
                }
            });
        }

        this.generation++;
        this.saveData();
        this.updateStats();
    }

    async run() {
        while (this.isRunning) {
            for (let i = 0; i < this.agents.length; i++) {
                if (this.games[i].gameOver) this.onAgentGameOver(i);
                else this.agents[i].step();
            }
            await new Promise(r => setTimeout(r, this.speed));
        }
    }
}

const multiAI = new MultiAgentAI();
