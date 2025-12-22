// Block Blast AI - 複数エージェント強化学習 + Firebase同期

// Firebase設定（あなたのプロジェクトに置き換えてください）
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com"
};

class CloudSync {
    constructor() {
        this.user = null;
        this.db = null;
        this.initialized = false;
    }

    async init() {
        if (typeof firebase === 'undefined') return false;
        try {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            this.db = firebase.database();
            this.initialized = true;
            
            firebase.auth().onAuthStateChanged(user => {
                this.user = user;
                this.updateLoginUI();
                if (user) this.loadFromCloud();
            });
            return true;
        } catch (e) {
            console.log('Firebase not configured');
            return false;
        }
    }

    updateLoginUI() {
        const btn = document.getElementById('loginBtn');
        const status = document.getElementById('loginStatus');
        if (this.user) {
            btn.textContent = 'ログアウト';
            status.textContent = this.user.email || 'ログイン中';
            status.style.color = '#1dd1a1';
        } else {
            btn.textContent = 'Googleログイン';
            status.textContent = '未ログイン';
            status.style.color = '#aaa';
        }
    }

    async login() {
        if (!this.initialized) { alert('Firebase未設定'); return; }
        if (this.user) {
            await firebase.auth().signOut();
        } else {
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebase.auth().signInWithPopup(provider);
        }
    }

    async saveToCloud(data) {
        if (!this.user || !this.db) return;
        try {
            await this.db.ref(`users/${this.user.uid}/aiData`).set(data);
            console.log('☁️ Saved to cloud');
        } catch (e) { console.error(e); }
    }

    async loadFromCloud() {
        if (!this.user || !this.db) return null;
        try {
            const snapshot = await this.db.ref(`users/${this.user.uid}/aiData`).once('value');
            const data = snapshot.val();
            if (data) console.log('☁️ Loaded from cloud');
            return data;
        } catch (e) { console.error(e); return null; }
    }
}

const cloudSync = new CloudSync();

// 単一AIエージェント
class AIAgent {
    constructor(id) {
        this.id = id;
        this.weights = this.randomWeights();
        this.score = 0;
        this.totalReward = 0;
        this.gamesPlayed = 0;
    }

    randomWeights() {
        return {
            linesCleared: 50 + Math.random() * 100,
            emptySpaces: Math.random() * 3,
            almostComplete: 5 + Math.random() * 10,
            holes: -1 - Math.random() * 5,
            edgeBonus: Math.random() * 2,
            compactness: Math.random() * 3,
            bigPieceFirst: Math.random() * 3
        };
    }

    clone() {
        const agent = new AIAgent(this.id);
        agent.weights = { ...this.weights };
        agent.totalReward = this.totalReward;
        return agent;
    }

    mutate(rate = 0.3, amount = 0.2) {
        for (const key in this.weights) {
            if (Math.random() < rate) {
                this.weights[key] += (Math.random() - 0.5) * 2 * amount * Math.abs(this.weights[key] || 1);
            }
        }
    }

    evaluateBoard(board) {
        let score = 0;
        let empty = 0;
        
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (board[y][x] === 0) empty++;
            }
        }
        score += this.weights.emptySpaces * empty;

        // ほぼ完成ライン
        for (let y = 0; y < BOARD_SIZE; y++) {
            let filled = board[y].filter(c => c !== 0).length;
            if (filled >= 6) score += this.weights.almostComplete * (filled - 5);
        }
        for (let x = 0; x < BOARD_SIZE; x++) {
            let filled = 0;
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (board[y][x] !== 0) filled++;
            }
            if (filled >= 6) score += this.weights.almostComplete * (filled - 5);
        }

        // 穴ペナルティ
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (board[y][x] === 0) {
                    let neighbors = 0;
                    if (y > 0 && board[y - 1][x] !== 0) neighbors++;
                    if (y < BOARD_SIZE - 1 && board[y + 1][x] !== 0) neighbors++;
                    if (x > 0 && board[y][x - 1] !== 0) neighbors++;
                    if (x < BOARD_SIZE - 1 && board[y][x + 1] !== 0) neighbors++;
                    if (neighbors >= 3) score += this.weights.holes;
                }
            }
        }

        // エッジボーナス
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i][0] !== 0) score += this.weights.edgeBonus;
            if (board[i][BOARD_SIZE - 1] !== 0) score += this.weights.edgeBonus;
            if (board[0][i] !== 0) score += this.weights.edgeBonus;
            if (board[BOARD_SIZE - 1][i] !== 0) score += this.weights.edgeBonus;
        }

        return score;
    }
}

// 複数エージェント管理
class MultiAgentAI {
    constructor(game) {
        this.game = game;
        this.isRunning = false;
        this.speed = 50;
        this.agentCount = 5;
        this.agents = [];
        this.currentAgent = null;
        this.generation = 1;
        this.totalGames = 0;
        this.bestScore = 0;
        this.bestAgent = null;
        this.recentScores = [];

        this.initAgents();
        this.loadData();
        this.setupUI();
        this.updateStats();
    }

    initAgents() {
        this.agents = [];
        for (let i = 0; i < this.agentCount; i++) {
            this.agents.push(new AIAgent(i));
        }
        this.currentAgent = this.agents[0];
    }

    loadData() {
        const saved = localStorage.getItem('blockBlastMultiAI');
        if (saved) {
            const data = JSON.parse(saved);
            this.generation = data.generation || 1;
            this.totalGames = data.totalGames || 0;
            this.bestScore = data.bestScore || 0;
            this.recentScores = data.recentScores || [];
            
            if (data.agents) {
                this.agents = data.agents.map((a, i) => {
                    const agent = new AIAgent(i);
                    agent.weights = a.weights;
                    agent.totalReward = a.totalReward || 0;
                    return agent;
                });
            }
            if (data.bestAgent) {
                this.bestAgent = new AIAgent(-1);
                this.bestAgent.weights = data.bestAgent.weights;
                this.bestAgent.totalReward = data.bestAgent.totalReward || 0;
            }
            this.currentAgent = this.agents[0];
        }
    }

    saveData() {
        const data = {
            generation: this.generation,
            totalGames: this.totalGames,
            bestScore: this.bestScore,
            recentScores: this.recentScores.slice(-100),
            agents: this.agents.map(a => ({ weights: a.weights, totalReward: a.totalReward })),
            bestAgent: this.bestAgent ? { weights: this.bestAgent.weights, totalReward: this.bestAgent.totalReward } : null
        };
        localStorage.setItem('blockBlastMultiAI', JSON.stringify(data));
        
        // クラウド同期
        if (cloudSync.user) cloudSync.saveToCloud(data);
    }

    async loadFromCloud() {
        const data = await cloudSync.loadFromCloud();
        if (data && data.generation > this.generation) {
            this.generation = data.generation;
            this.totalGames = data.totalGames;
            this.bestScore = data.bestScore;
            this.recentScores = data.recentScores || [];
            if (data.agents) {
                this.agents = data.agents.map((a, i) => {
                    const agent = new AIAgent(i);
                    agent.weights = a.weights;
                    agent.totalReward = a.totalReward || 0;
                    return agent;
                });
            }
            if (data.bestAgent) {
                this.bestAgent = new AIAgent(-1);
                this.bestAgent.weights = data.bestAgent.weights;
            }
            this.currentAgent = this.agents[0];
            this.updateStats();
            console.log('☁️ Synced from cloud!');
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
            this.initAgents();
            this.updateStats();
        });

        document.getElementById('loginBtn').addEventListener('click', () => cloudSync.login());

        // Firebase初期化
        cloudSync.init().then(() => {
            if (cloudSync.user) this.loadFromCloud();
        });
    }

    updateStats() {
        document.getElementById('generation').textContent = this.generation;
        document.getElementById('trainCount').textContent = this.totalGames;
        document.getElementById('bestScoreAI').textContent = this.bestScore;
        
        const avg = this.recentScores.length > 0
            ? Math.round(this.recentScores.reduce((a, b) => a + b, 0) / this.recentScores.length)
            : 0;
        document.getElementById('avgScore').textContent = avg;
        
        document.getElementById('currentAgent').textContent = 
            this.currentAgent ? `Agent ${this.currentAgent.id + 1}` : '-';
    }

    simulateMove(board, piece, x, y) {
        const newBoard = board.map(row => [...row]);
        for (let py = 0; py < piece.shape.length; py++) {
            for (let px = 0; px < piece.shape[py].length; px++) {
                if (piece.shape[py][px]) {
                    newBoard[y + py][x + px] = piece.color;
                }
            }
        }

        let linesCleared = 0;
        for (let row = 0; row < BOARD_SIZE; row++) {
            if (newBoard[row].every(c => c !== 0)) {
                for (let col = 0; col < BOARD_SIZE; col++) newBoard[row][col] = 0;
                linesCleared++;
            }
        }
        for (let col = 0; col < BOARD_SIZE; col++) {
            let full = true;
            for (let row = 0; row < BOARD_SIZE; row++) {
                if (newBoard[row][col] === 0) { full = false; break; }
            }
            if (full) {
                for (let row = 0; row < BOARD_SIZE; row++) newBoard[row][col] = 0;
                linesCleared++;
            }
        }
        return { board: newBoard, linesCleared };
    }

    findBestMove(agent) {
        const moves = this.game.getValidMoves();
        if (moves.length === 0) return null;

        let bestMove = null;
        let bestScore = -Infinity;

        for (const move of moves) {
            const piece = this.game.pieces[move.pieceIndex];
            const result = this.simulateMove(this.game.board, piece, move.x, move.y);

            let moveScore = result.linesCleared * agent.weights.linesCleared;
            moveScore += agent.evaluateBoard(result.board);
            
            const blockSize = piece.shape.flat().filter(c => c).length;
            moveScore += blockSize * agent.weights.bigPieceFirst;

            if (moveScore > bestScore) {
                bestScore = moveScore;
                bestMove = move;
            }
        }
        return bestMove;
    }

    // 報酬ベース進化
    evolve() {
        const score = this.game.score;
        this.recentScores.push(score);
        if (this.recentScores.length > 100) this.recentScores.shift();

        // 報酬計算（スコアに応じてポイント付与）
        const reward = Math.pow(score / 100, 1.5); // 高スコアほど報酬増加
        this.currentAgent.totalReward += reward;
        this.currentAgent.score = score;
        this.currentAgent.gamesPlayed++;

        // ベスト更新
        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestAgent = this.currentAgent.clone();
            console.log(`🏆 New best: ${score} by Agent ${this.currentAgent.id + 1}`);
        }

        this.totalGames++;

        // 世代交代（全エージェントが1ゲームずつプレイしたら）
        const nextAgentIndex = (this.currentAgent.id + 1) % this.agents.length;
        
        if (nextAgentIndex === 0) {
            this.generation++;
            this.evolveGeneration();
        }

        this.currentAgent = this.agents[nextAgentIndex];
        this.saveData();
        this.updateStats();
    }

    evolveGeneration() {
        // 報酬でソート
        this.agents.sort((a, b) => b.totalReward - a.totalReward);

        console.log(`📊 Gen ${this.generation} rewards:`, this.agents.map(a => Math.round(a.totalReward)));

        // 上位半分を残し、下位を上位のクローン+変異で置き換え
        const survivors = Math.ceil(this.agents.length / 2);
        
        for (let i = survivors; i < this.agents.length; i++) {
            const parent = this.agents[i % survivors];
            this.agents[i] = parent.clone();
            this.agents[i].id = i;
            this.agents[i].mutate(0.5, 0.3);
            this.agents[i].totalReward = 0;
            this.agents[i].gamesPlayed = 0;
        }

        // ベストエージェントの遺伝子を少し混ぜる
        if (this.bestAgent) {
            for (let i = 0; i < survivors; i++) {
                for (const key in this.agents[i].weights) {
                    if (Math.random() < 0.2) {
                        this.agents[i].weights[key] = this.bestAgent.weights[key];
                    }
                }
            }
        }

        // 上位の報酬をリセット（次世代用）
        for (let i = 0; i < survivors; i++) {
            this.agents[i].totalReward *= 0.5; // 少し残す
        }

        // IDを振り直し
        this.agents.forEach((a, i) => a.id = i);
    }

    async run() {
        while (this.isRunning) {
            if (this.game.gameOver) {
                this.evolve();
                await this.sleep(100);
                this.game.init();
                continue;
            }

            const move = this.findBestMove(this.currentAgent);
            if (move) {
                this.game.placePiece(move.pieceIndex, move.x, move.y);
            }

            await this.sleep(this.speed);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const ai = new MultiAgentAI(game);
