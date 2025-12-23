// Gemini AI クラス
class GeminiAI {
    constructor() {
        this.apiKey = localStorage.getItem('geminiApiKey') || '';
        this.isEnabled = false;
        this.requestCount = parseInt(localStorage.getItem('geminiRequestCount') || '0');
        this.lastRequestTime = 0;
        this.minInterval = 200; // 200ms間隔（高速化）
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('geminiApiKey', key);
    }

    updateRequestDisplay() {
        const el = document.getElementById('geminiRequests');
        if (el) el.textContent = this.requestCount;
        localStorage.setItem('geminiRequestCount', this.requestCount.toString());
    }

    async getMove(gameState) {
        if (!this.apiKey || !this.isEnabled) return null;
        
        // レート制限（短縮）
        const now = Date.now();
        if (now - this.lastRequestTime < this.minInterval) {
            return null;
        }
        this.lastRequestTime = now;

        const prompt = this.buildPrompt(gameState);
        
        try {
            // Gemini 2.0 Flash（最新・最速モデル）
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 100
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('Gemini API error:', response.status, errText);
                return null;
            }

            const data = await response.json();
            this.requestCount++;
            this.updateRequestDisplay();
            
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            console.log('Gemini response:', text);
            return this.parseResponse(text, gameState.validMoves);
        } catch (e) {
            console.error('Gemini request failed:', e);
            return null;
        }
    }

    buildPrompt(state) {
        const boardStr = state.board.map(row => 
            row.map(c => c ? '■' : '□').join('')
        ).join('\n');

        const movesStr = state.validMoves.slice(0, 30).map((m, i) => 
            `${i}:p${m.pieceIndex}(${m.x},${m.y})`
        ).join(' ');

        return `Block Blast 8x8。行/列が埋まると消える。
ボード:
${boardStr}

配置候補: ${movesStr}

最良の配置番号を「選択:X」で回答。`;
    }

    parseResponse(text, validMoves) {
        // 複数パターンで番号を抽出
        const patterns = [
            /選択[:：]\s*(\d+)/,
            /(\d+)/
        ];
        for (const p of patterns) {
            const match = text.match(p);
            if (match) {
                const idx = parseInt(match[1]);
                if (idx >= 0 && idx < validMoves.length) {
                    return validMoves[idx];
                }
            }
        }
        return null;
    }
}

const geminiAI = new GeminiAI();

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
                if (user && window.multiAI) {
                    multiAI.loadFromCloud();
                    multiAI.loadGlobalBest();
                }
            });
            // 定期的にグローバルベストをチェック
            setInterval(() => { if (window.multiAI) multiAI.loadGlobalBest(); }, 30000);
            return true;
        } catch (e) { console.error(e); return false; }
    }
    
    async login() {
        if (!this.initialized) return;
        if (this.user) await firebase.auth().signOut();
        else await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }
    
    // 自分のデータ保存
    async save(data) {
        if (!this.user || !this.db) return;
        await this.db.ref(`users/${this.user.uid}/aiData`).set(data);
        // グローバルベストも更新
        if (data.bestScore && data.bestWeights) {
            await this.updateGlobalBest(data.bestScore, data.bestWeights);
        }
    }
    
    // 自分のデータ読み込み
    async load() {
        if (!this.user || !this.db) return null;
        return (await this.db.ref(`users/${this.user.uid}/aiData`).once('value')).val();
    }
    
    // グローバルベスト更新
    async updateGlobalBest(score, weights) {
        if (!this.db) return;
        try {
            const current = await this.db.ref('globalBest').once('value');
            const data = current.val();
            if (!data || score > data.score) {
                await this.db.ref('globalBest').set({
                    score,
                    weights,
                    userId: this.user?.uid || 'anonymous',
                    userName: this.user?.email?.split('@')[0] || 'anonymous',
                    updatedAt: Date.now()
                });
                console.log('🌍 Updated global best!');
            }
        } catch (e) { console.error(e); }
    }
    
    // グローバルベスト取得
    async getGlobalBest() {
        if (!this.db) return null;
        try {
            const snapshot = await this.db.ref('globalBest').once('value');
            return snapshot.val();
        } catch (e) { console.error(e); return null; }
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
            linesClear: 250,
            multiLine: 150,
            almostLine7: 50,
            almostLine6: 25,
            almostLine5: 10,
            emptyBonus: 1.8,
            holePenalty: -35,
            hole4Penalty: -120,
            edgeBonus: 4,
            cornerBonus: 8,
            bigPiece: 2.5,
            futureBonus: 0.6,
            rowColBalance: 6,
            centerPenalty: -1.5
        };
    }

    // 最適化された初期値（学習済み）
    static getOptimizedWeights() {
        return {
            linesClear: 280,
            multiLine: 180,
            almostLine7: 60,
            almostLine6: 30,
            almostLine5: 12,
            emptyBonus: 2.0,
            holePenalty: -40,
            hole4Penalty: -150,
            edgeBonus: 5,
            cornerBonus: 10,
            bigPiece: 3,
            futureBonus: 0.8,
            rowColBalance: 7,
            centerPenalty: -2
        };
    }

    get avgScore() { return this.gamesPlayed > 0 ? Math.round(this.totalScore / this.gamesPlayed) : 0; }
    copyFrom(w) { this.weights = { ...w }; }
    
    mutate(rate = 0.3, amount = 0.15) {
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

        let empty = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (board[y][x] === 0) empty++;
        score += this.weights.emptyBonus * empty;

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

        const rowAvg = rowFills.reduce((a, b) => a + b, 0) / S;
        const colAvg = colFills.reduce((a, b) => a + b, 0) / S;
        const rowVar = rowFills.reduce((a, b) => a + Math.abs(b - rowAvg), 0) / S;
        const colVar = colFills.reduce((a, b) => a + Math.abs(b - colAvg), 0) / S;
        score -= (rowVar + colVar) * this.weights.rowColBalance * 0.1;

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

    findBestMove() {
        const validMoves = this.game.getValidMoves();
        if (validMoves.length === 0) return null;

        let best = null, bestScore = -Infinity;
        const pieces = this.game.pieces;

        for (const m of validMoves) {
            const piece = pieces[m.pieceIndex];
            const result = this.simulate(this.game.board, piece, m.x, m.y);
            
            let moveScore = result.lines * this.weights.linesClear;
            if (result.lines >= 2) moveScore += result.lines * this.weights.multiLine;
            moveScore += this.evaluateBoard(result.board);
            moveScore += piece.shape.flat().filter(c => c).length * this.weights.bigPiece;

            const remaining = pieces.map((p, i) => i === m.pieceIndex ? { ...p, used: true } : p);
            const futureMoves = this.countValidMoves(result.board, remaining);
            moveScore += futureMoves * this.weights.futureBonus;

            // 2手先読み
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
        if (!this.canvas) {
            console.error('graphCanvas not found!');
            return;
        }
        this.ctx = this.canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.data = { scores: [], avgScores: [], maxScores: [], timestamps: [] };
        this.viewMode = 'recent';
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);
        this.W = rect.width;
        this.H = rect.height;
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
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const W = this.W, H = this.H;
        
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
        const pad = { top: 25, right: 15, bottom: 25, left: 50 };
        const gW = W - pad.left - pad.right;
        const gH = H - pad.top - pad.bottom;

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

        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(W - 120, 8, 12, 12);
        ctx.fillText('最高', W - 105, 18);
        ctx.fillStyle = '#feca57';
        ctx.fillRect(W - 65, 8, 12, 12);
        ctx.fillText('平均', W - 50, 18);

        if (avgScores.length > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`平均: ${avgScores[avgScores.length - 1]} / 最高: ${maxScores[maxScores.length - 1]}`, W - 15, H - 5);
        }

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
        console.log('MultiAgentAI: Starting initialization...');
        
        this.container = document.getElementById('gamesContainer');
        if (!this.container) {
            console.error('gamesContainer not found!');
            return;
        }
        
        this.agents = [];
        this.games = [];
        this.agentCount = 6;
        this.isRunning = false;
        this.speed = 20;
        this.generation = 1;
        this.totalGames = 0;
        this.bestScore = 0;
        this.bestWeights = null;
        this.globalBestScore = 0;
        this.globalBestWeights = null;
        this.aiMode = 'genetic'; // 'genetic' or 'gemini'
        
        try {
            this.graph = new StatsGraph();
            console.log('MultiAgentAI: StatsGraph created');
        } catch (e) {
            console.error('StatsGraph error:', e);
        }

        try {
            this.loadData();
            console.log('MultiAgentAI: Data loaded');
        } catch (e) {
            console.error('loadData error:', e);
        }
        
        try {
            this.createAgents();
            console.log('MultiAgentAI: Agents created');
        } catch (e) {
            console.error('createAgents error:', e);
        }
        
        try {
            this.setupUI();
            console.log('MultiAgentAI: UI setup complete');
        } catch (e) {
            console.error('setupUI error:', e);
        }
        
        try {
            this.updateStats();
        } catch (e) {
            console.error('updateStats error:', e);
        }
        
        cloudSync.init();
        console.log('MultiAgentAI: Initialization complete!');
    }

    createAgents() {
        this.games.forEach(g => g.destroy());
        this.games = [];
        this.agents = [];

        // 使用する重み（グローバルベスト > 自分のベスト > 最適化済み初期値）
        const baseWeights = this.globalBestWeights || this.bestWeights || AIAgent.getOptimizedWeights();

        for (let i = 0; i < this.agentCount; i++) {
            const game = new BlockBlastGame(this.container, i, false);
            this.games.push(game);
            
            const agent = new AIAgent(i, game);
            agent.copyFrom(baseWeights);
            if (i > 0) agent.mutate(0.35, 0.2);
            this.agents.push(agent);
        }
    }

    loadData() {
        try {
            const saved = localStorage.getItem('blockBlastAI_v7');
            if (saved) {
                const data = JSON.parse(saved);
                this.generation = data.generation || 1;
                this.totalGames = data.totalGames || 0;
                this.bestScore = data.bestScore || 0;
                this.bestWeights = data.bestWeights || null;
                if (data.graphData && this.graph) this.graph.loadData(data.graphData);
            }
        } catch (e) {
            console.error('Error loading data:', e);
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
        localStorage.setItem('blockBlastAI_v7', JSON.stringify(data));
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
            console.log('☁️ Loaded personal best from cloud');
        }
    }

    async loadGlobalBest() {
        const global = await cloudSync.getGlobalBest();
        if (global && global.score > this.globalBestScore) {
            this.globalBestScore = global.score;
            this.globalBestWeights = global.weights;
            document.getElementById('globalBest').textContent = global.score;
            document.getElementById('globalBestUser').textContent = global.userName || '?';
            console.log(`🌍 Global best: ${global.score} by ${global.userName}`);
            
            // グローバルベストが自分より良ければ、エージェントに反映
            if (global.score > this.bestScore) {
                this.agents.forEach((a, i) => {
                    if (i === 0 || Math.random() < 0.3) {
                        a.copyFrom(global.weights);
                        if (i > 0) a.mutate(0.3, 0.15);
                    }
                });
            }
        }
    }

    setupUI() {
        const toggleBtn = document.getElementById('toggleAI');
        const speedSlider = document.getElementById('aiSpeed');
        const agentSelect = document.getElementById('agentCount');
        const loginBtn = document.getElementById('loginBtn');
        const useGlobalBtn = document.getElementById('useGlobalBest');
        const graphRecent = document.getElementById('graphRecent');
        const graphAll = document.getElementById('graphAll');
        const graphDaily = document.getElementById('graphDaily');
        const graphReset = document.getElementById('graphReset');
        
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                console.log('Toggle AI clicked');
                this.isRunning = !this.isRunning;
                toggleBtn.textContent = this.isRunning ? 'AI停止' : 'AI開始';
                toggleBtn.classList.toggle('active', this.isRunning);
                if (this.isRunning) this.run();
            });
        } else {
            console.error('toggleAI button not found!');
        }

        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.speed = parseInt(e.target.value);
                document.getElementById('speedValue').textContent = this.speed + 'ms';
            });
        }

        if (agentSelect) {
            agentSelect.addEventListener('change', (e) => {
                this.agentCount = parseInt(e.target.value);
                this.createAgents();
            });
        }

        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                console.log('Login clicked');
                cloudSync.login();
            });
        } else {
            console.error('loginBtn not found!');
        }
        
        if (useGlobalBtn) {
            useGlobalBtn.addEventListener('click', () => {
                if (this.globalBestWeights) {
                    this.bestWeights = { ...this.globalBestWeights };
                    this.createAgents();
                    alert('グローバルベストの学習データを適用しました！');
                } else {
                    alert('グローバルベストがまだありません');
                }
            });
        }
        
        // Gemini設定
        const geminiKeyInput = document.getElementById('geminiApiKey');
        const geminiSaveBtn = document.getElementById('saveGeminiKey');
        const aiModeSelect = document.getElementById('aiMode');
        
        if (geminiKeyInput && geminiAI.apiKey) {
            geminiKeyInput.value = geminiAI.apiKey;
        }
        
        if (geminiSaveBtn) {
            geminiSaveBtn.addEventListener('click', () => {
                const key = geminiKeyInput?.value?.trim();
                if (key) {
                    geminiAI.setApiKey(key);
                    alert('APIキーを保存しました');
                }
            });
        }
        
        if (aiModeSelect) {
            aiModeSelect.addEventListener('change', (e) => {
                this.aiMode = e.target.value;
                geminiAI.isEnabled = (this.aiMode === 'gemini');
                console.log('AI Mode:', this.aiMode);
                
                // Geminiモードは1エージェントのみ
                if (this.aiMode === 'gemini') {
                    this.agentCount = 1;
                    const agentSelect = document.getElementById('agentCount');
                    if (agentSelect) agentSelect.value = '1';
                    this.createAgents();
                }
            });
        }
        
        // グラフボタン
        if (graphRecent) {
            graphRecent.addEventListener('click', () => this.setGraphView('recent'));
        }
        if (graphAll) {
            graphAll.addEventListener('click', () => this.setGraphView('all'));
        }
        if (graphDaily) {
            graphDaily.addEventListener('click', () => this.setGraphView('daily'));
        }
        if (graphReset) {
            graphReset.addEventListener('click', () => this.resetGraph());
        }
    }
    
    setGraphView(mode) {
        if (!this.graph) return;
        this.graph.viewMode = mode;
        document.querySelectorAll('.graph-btn:not(#graphReset)').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('graph' + mode.charAt(0).toUpperCase() + mode.slice(1));
        if (btn) btn.classList.add('active');
        this.graph.draw();
    }
    
    resetGraph() {
        if (confirm('グラフデータをリセットしますか？')) {
            if (this.graph) {
                this.graph.data = { scores: [], avgScores: [], maxScores: [], timestamps: [] };
                this.graph.draw();
            }
            this.generation = 1;
            this.totalGames = 0;
            this.saveData();
            this.updateStats();
        }
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
            console.log(`🏆 New personal best: ${score}`);
            this.games[idx].element.style.boxShadow = '0 0 30px #feca57';
            setTimeout(() => this.games[idx].element.style.boxShadow = '', 2000);
        }

        const minGames = Math.min(...this.agents.map(a => a.gamesPlayed));
        if (minGames > 0 && minGames % 2 === 0) this.evolve();

        this.games[idx].init();
        if (this.totalGames % 15 === 0) { this.saveData(); this.updateStats(); }
    }

    evolve() {
        const ranked = this.agents.map((a, i) => ({ agent: a, idx: i, avg: a.avgScore, best: a.bestScore }))
            .sort((a, b) => b.avg - a.avg);
        console.log(`📊 Gen ${this.generation}:`, ranked.slice(0, 5).map(r => `${r.avg}(${r.best})`).join(', '));

        // 進化が停滞しているか判定
        const recentAvgs = this.graph.data.avgScores.slice(-30);
        const olderAvgs = this.graph.data.avgScores.slice(-60, -30);
        let isStagnant = false;
        if (recentAvgs.length >= 20 && olderAvgs.length >= 20) {
            const recentMean = recentAvgs.reduce((a, b) => a + b, 0) / recentAvgs.length;
            const olderMean = olderAvgs.reduce((a, b) => a + b, 0) / olderAvgs.length;
            isStagnant = Math.abs(recentMean - olderMean) < olderMean * 0.05; // 5%未満の変化
        }

        const elite = Math.max(1, Math.floor(this.agents.length * 0.15)); // エリートを減らす
        
        // 停滞時は大きく変異
        const mutateRate = isStagnant ? 0.6 : 0.35;
        const mutateAmount = isStagnant ? 0.4 : 0.2;
        
        if (isStagnant) {
            console.log('⚠️ 学習停滞検出 - 探索範囲を拡大');
        }

        for (let i = 0; i < this.agents.length; i++) {
            const target = this.agents[ranked[i].idx];
            
            if (i < elite) {
                // エリートは軽い変異のみ
                target.mutate(0.1, 0.08);
            } else if (i < this.agents.length / 2) {
                // 中位：エリートからコピー＋変異
                const parentIdx = Math.floor(Math.random() * elite);
                target.copyFrom(ranked[parentIdx].agent.weights);
                target.mutate(mutateRate, mutateAmount);
            } else {
                // 下位：ランダム探索 or エリートから大きく変異
                if (Math.random() < 0.3 || isStagnant) {
                    // 完全ランダム（新しい探索）
                    target.weights = target.randomWeights();
                    // ベストの一部を継承
                    const bestW = this.globalBestWeights || this.bestWeights;
                    if (bestW) {
                        for (const k in target.weights) {
                            if (Math.random() < 0.3) target.weights[k] = bestW[k];
                        }
                    }
                    target.mutate(0.5, 0.3);
                } else {
                    const parentIdx = Math.floor(Math.random() * elite);
                    target.copyFrom(ranked[parentIdx].agent.weights);
                    target.mutate(0.5, 0.35);
                }
            }
            target.gamesPlayed = 0;
            target.totalScore = 0;
        }

        // クロスオーバー：上位2つの重みを混合した子を作成
        if (this.agents.length >= 4 && ranked.length >= 2) {
            const parent1 = ranked[0].agent.weights;
            const parent2 = ranked[1].agent.weights;
            const child = this.agents[ranked[this.agents.length - 1].idx];
            for (const k in child.weights) {
                child.weights[k] = Math.random() < 0.5 ? parent1[k] : parent2[k];
            }
            child.mutate(0.2, 0.15);
        }

        this.generation++;
        this.saveData();
        this.updateStats();
    }

    async run() {
        while (this.isRunning) {
            if (this.aiMode === 'gemini' && geminiAI.isEnabled && geminiAI.apiKey) {
                // Geminiモード（1エージェントのみ）
                const game = this.games[0];
                if (game.gameOver) {
                    this.onAgentGameOver(0);
                } else {
                    const gameState = {
                        board: game.board,
                        pieces: game.pieces,
                        validMoves: game.getValidMoves()
                    };
                    
                    const move = await geminiAI.getMove(gameState);
                    if (move) {
                        game.placePiece(move.pieceIndex, move.x, move.y);
                    } else {
                        // Geminiが応答しない場合は遺伝的AIにフォールバック
                        this.agents[0].step();
                    }
                }
                // Geminiモードは速度スライダーを反映（最低50ms）
                await new Promise(r => setTimeout(r, Math.max(this.speed, 50)));
            } else {
                // 遺伝的アルゴリズムモード
                for (let i = 0; i < this.agents.length; i++) {
                    if (this.games[i].gameOver) this.onAgentGameOver(i);
                    else this.agents[i].step();
                }
                await new Promise(r => setTimeout(r, this.speed));
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.multiAI = new MultiAgentAI();
});
