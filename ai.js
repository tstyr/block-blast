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

// 強化学習AIエージェント
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
            linesClear: 150 + Math.random() * 50,
            almostLine7: 25 + Math.random() * 15,
            almostLine6: 12 + Math.random() * 8,
            emptyBonus: 0.8 + Math.random() * 0.4,
            holePenalty: -15 - Math.random() * 10,
            edgeBonus: 2 + Math.random() * 2,
            cornerBonus: 4 + Math.random() * 3,
            bigPiece: 1 + Math.random() * 1,
            futureMovesBonus: 0.3 + Math.random() * 0.2
        };
    }

    get avgScore() { return this.gamesPlayed > 0 ? Math.round(this.totalScore / this.gamesPlayed) : 0; }
    copyFrom(w) { this.weights = { ...w }; }
    
    mutate(rate = 0.35, amount = 0.25) {
        for (const k in this.weights) {
            if (Math.random() < rate) {
                this.weights[k] *= (1 + (Math.random() - 0.5) * amount * 2);
            }
        }
    }

    evaluateBoard(board, remainingPieces) {
        let score = 0;
        const S = BOARD_SIZE;

        // 空きマス
        let empty = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (board[y][x] === 0) empty++;
        score += this.weights.emptyBonus * empty;

        // 行の充填度
        for (let y = 0; y < S; y++) {
            const filled = board[y].filter(c => c !== 0).length;
            if (filled === S - 1) score += this.weights.almostLine7;
            else if (filled === S - 2) score += this.weights.almostLine6;
        }
        // 列の充填度
        for (let x = 0; x < S; x++) {
            let filled = 0;
            for (let y = 0; y < S; y++) if (board[y][x] !== 0) filled++;
            if (filled === S - 1) score += this.weights.almostLine7;
            else if (filled === S - 2) score += this.weights.almostLine6;
        }

        // 穴ペナルティ
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (board[y][x] === 0) {
                    let walls = 0;
                    if (y === 0 || board[y-1][x] !== 0) walls++;
                    if (y === S-1 || board[y+1][x] !== 0) walls++;
                    if (x === 0 || board[y][x-1] !== 0) walls++;
                    if (x === S-1 || board[y][x+1] !== 0) walls++;
                    if (walls >= 3) score += this.weights.holePenalty;
                    if (walls === 4) score += this.weights.holePenalty * 2;
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

        // 将来の配置可能数
        if (remainingPieces) {
            let futureMoves = 0;
            for (const p of remainingPieces) {
                if (p.used) continue;
                for (let y = 0; y < S; y++) {
                    for (let x = 0; x < S; x++) {
                        if (this.canPlace(board, p, x, y)) futureMoves++;
                    }
                }
            }
            score += this.weights.futureMovesBonus * futureMoves;
        }

        return score;
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
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (newBoard[y].every(c => c !== 0)) {
                for (let x = 0; x < BOARD_SIZE; x++) newBoard[y][x] = 0;
                lines++;
            }
        }
        for (let x = 0; x < BOARD_SIZE; x++) {
            let full = true;
            for (let y = 0; y < BOARD_SIZE; y++) if (newBoard[y][x] === 0) { full = false; break; }
            if (full) {
                for (let y = 0; y < BOARD_SIZE; y++) newBoard[y][x] = 0;
                lines++;
            }
        }
        return { board: newBoard, lines };
    }

    findBestMove() {
        const validMoves = this.game.getValidMoves();
        if (validMoves.length === 0) return null;

        let best = null, bestScore = -Infinity;

        for (const m of validMoves) {
            const piece = this.game.pieces[m.pieceIndex];
            const result = this.simulate(this.game.board, piece, m.x, m.y);
            
            // 残りピース
            const remaining = this.game.pieces.map((p, i) => 
                i === m.pieceIndex ? { ...p, used: true } : p
            );

            let moveScore = result.lines * this.weights.linesClear;
            moveScore += result.lines * result.lines * 20; // コンボボーナス
            moveScore += this.evaluateBoard(result.board, remaining);
            moveScore += piece.shape.flat().filter(c => c).length * this.weights.bigPiece;

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

// グラフ描画クラス
class StatsGraph {
    constructor() {
        this.canvas = document.getElementById('graphCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.data = { scores: [], avgScores: [], maxScores: [], timestamps: [] };
        this.viewMode = 'recent'; // 'recent', 'all', 'daily'
        this.setupUI();
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
        
        // 移動平均計算
        const recent = this.data.scores.slice(-20);
        this.data.avgScores.push(recent.reduce((a, b) => a + b, 0) / recent.length);
        
        // 最高スコア更新
        const currentMax = this.data.maxScores.length > 0 ? this.data.maxScores[this.data.maxScores.length - 1] : 0;
        this.data.maxScores.push(Math.max(currentMax, score));

        if (this.data.scores.length % 5 === 0) this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, W, H);

        let scores, avgScores, maxScores, labels;

        if (this.viewMode === 'daily') {
            const daily = this.getDailyData();
            scores = daily.scores;
            avgScores = daily.avgs;
            maxScores = daily.maxes;
            labels = daily.labels;
        } else if (this.viewMode === 'recent') {
            const n = Math.min(100, this.data.scores.length);
            scores = this.data.scores.slice(-n);
            avgScores = this.data.avgScores.slice(-n);
            maxScores = this.data.maxScores.slice(-n);
            labels = null;
        } else {
            scores = this.data.scores;
            avgScores = this.data.avgScores;
            maxScores = this.data.maxScores;
            labels = null;
        }

        if (scores.length < 2) return;

        const allVals = [...scores, ...avgScores, ...maxScores];
        const maxVal = Math.max(...allVals, 100);
        const minVal = 0;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const graphW = W - padding.left - padding.right;
        const graphH = H - padding.top - padding.bottom;

        // グリッド
        ctx.strokeStyle = '#1a1a3e';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (graphH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(W - padding.right, y);
            ctx.stroke();
            
            ctx.fillStyle = '#666';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal - (maxVal / 5) * i), padding.left - 5, y + 3);
        }

        // ライン描画関数
        const drawLine = (data, color, alpha = 1) => {
            if (data.length < 2) return;
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 2;
            ctx.beginPath();
            data.forEach((v, i) => {
                const x = padding.left + (i / (data.length - 1)) * graphW;
                const y = padding.top + graphH - ((v - minVal) / (maxVal - minVal)) * graphH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        // 各ライン描画
        drawLine(scores, '#48dbfb', 0.3);      // 個別スコア（薄く）
        drawLine(avgScores, '#feca57', 1);     // 平均（黄色）
        drawLine(maxScores, '#ff6b6b', 1);     // 最高（赤）

        // 凡例
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#ff6b6b'; ctx.fillText('● 最高', W - 100, 15);
        ctx.fillStyle = '#feca57'; ctx.fillText('● 平均', W - 50, 15);

        // 日別ラベル
        if (labels && labels.length > 0) {
            ctx.fillStyle = '#666';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            const step = Math.ceil(labels.length / 7);
            labels.forEach((l, i) => {
                if (i % step === 0) {
                    const x = padding.left + (i / (labels.length - 1)) * graphW;
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
        const scores = labels.map(d => daily[d].reduce((a, b) => a + b, 0) / daily[d].length);
        const avgs = scores;
        const maxes = labels.map(d => Math.max(...daily[d]));

        return { labels, scores, avgs, maxes };
    }

    loadData(data) {
        if (data) {
            this.data = data;
            this.draw();
        }
    }

    getData() {
        return this.data;
    }
}

// マルチエージェント管理
class MultiAgentAI {
    constructor() {
        this.container = document.getElementById('gamesContainer');
        this.agents = [];
        this.games = [];
        this.agentCount = 6;
        this.isRunning = false;
        this.speed = 30;
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
                agent.mutate(0.4, 0.3);
            }
            this.agents.push(agent);
        }
    }

    loadData() {
        const saved = localStorage.getItem('blockBlastAI_v5');
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
        localStorage.setItem('blockBlastAI_v5', JSON.stringify(data));
        if (cloudSync.user) cloudSync.save(data);
    }

    async loadFromCloud() {
        const data = await cloudSync.load();
        if (data && data.bestScore > this.bestScore) {
            this.generation = Math.max(this.generation, data.generation || 1);
            this.totalGames = Math.max(this.totalGames, data.totalGames || 0);
            this.bestScore = data.bestScore;
            this.bestWeights = data.bestWeights;
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
        const recent = gd.avgScores.slice(-20);
        const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
        document.getElementById('avgScore').textContent = avg;

        // 成長率
        const older = gd.avgScores.slice(-40, -20);
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

        // ベスト更新
        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestWeights = { ...agent.weights };
            console.log(`🏆 New best: ${score} by AI ${idx + 1}`);
            this.games[idx].element.style.boxShadow = '0 0 25px #feca57';
            setTimeout(() => this.games[idx].element.style.boxShadow = '', 1500);
        }

        // 進化チェック
        const minGames = Math.min(...this.agents.map(a => a.gamesPlayed));
        if (minGames > 0 && minGames % 5 === 0) {
            this.evolve();
        }

        // 即リスタート
        this.games[idx].init();
        
        if (this.totalGames % 20 === 0) {
            this.saveData();
            this.updateStats();
        }
    }

    evolve() {
        // 平均スコアでランキング
        const ranked = this.agents
            .map((a, i) => ({ agent: a, idx: i, avg: a.avgScore }))
            .sort((a, b) => b.avg - a.avg);

        console.log(`📊 Gen ${this.generation}:`, ranked.map(r => r.avg).join(', '));

        // 上位50%を残し、下位を上位の変異コピーで置換
        const survivors = Math.max(2, Math.ceil(this.agents.length / 2));
        
        for (let i = survivors; i < this.agents.length; i++) {
            const parentIdx = i % survivors;
            const parent = ranked[parentIdx].agent;
            
            // 交叉も導入
            if (survivors >= 2 && Math.random() < 0.3) {
                const parent2 = ranked[(parentIdx + 1) % survivors].agent;
                for (const k in this.agents[ranked[i].idx].weights) {
                    this.agents[ranked[i].idx].weights[k] = 
                        Math.random() < 0.5 ? parent.weights[k] : parent2.weights[k];
                }
            } else {
                this.agents[ranked[i].idx].copyFrom(parent.weights);
            }
            
            this.agents[ranked[i].idx].mutate(0.4, 0.3);
            this.agents[ranked[i].idx].gamesPlayed = 0;
            this.agents[ranked[i].idx].totalScore = 0;
        }

        // ベストの遺伝子を注入
        if (this.bestWeights) {
            this.agents.forEach(a => {
                for (const k in a.weights) {
                    if (Math.random() < 0.1) a.weights[k] = this.bestWeights[k];
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
                if (this.games[i].gameOver) {
                    this.onAgentGameOver(i);
                } else {
                    this.agents[i].step();
                }
            }
            await new Promise(r => setTimeout(r, this.speed));
        }
    }
}

const multiAI = new MultiAgentAI();
