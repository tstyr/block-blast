// Firebase設定
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCRWWrJyQm6x9b8DkgA9jkQWgLxRENotAg",
    authDomain: "block-blast-653e1.firebaseapp.com",
    projectId: "block-blast-653e1",
    databaseURL: "https://block-blast-653e1-default-rtdb.asia-southeast1.firebasedatabase.app",
    storageBucket: "block-blast-653e1.firebasestorage.app",
    messagingSenderId: "561520195184",
    appId: "1:561520195184:web:82d6d93c22e00f691e26b5"
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
                this.updateUI();
                if (user && window.multiAI) multiAI.loadFromCloud();
            });
            return true;
        } catch (e) { return false; }
    }
    updateUI() {
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
        if (!this.initialized) return;
        if (this.user) await firebase.auth().signOut();
        else await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }
    async save(data) {
        if (!this.user || !this.db) return;
        await this.db.ref(`users/${this.user.uid}/aiData`).set(data);
    }
    async load() {
        if (!this.user || !this.db) return null;
        const snapshot = await this.db.ref(`users/${this.user.uid}/aiData`).once('value');
        return snapshot.val();
    }
}
const cloudSync = new CloudSync();

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
            linesCleared: 50 + Math.random() * 100,
            emptySpaces: Math.random() * 3,
            almostComplete: 5 + Math.random() * 15,
            holes: -2 - Math.random() * 6,
            edgeBonus: Math.random() * 2,
            bigPieceFirst: Math.random() * 4,
            connectivity: Math.random() * 2
        };
    }

    get avgScore() {
        return this.gamesPlayed > 0 ? Math.round(this.totalScore / this.gamesPlayed) : 0;
    }

    copyFrom(other) {
        this.weights = { ...other.weights };
    }

    mutate(rate = 0.4, amount = 0.25) {
        for (const key in this.weights) {
            if (Math.random() < rate) {
                this.weights[key] *= 1 + (Math.random() - 0.5) * amount * 2;
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

        // ほぼ完成ライン（重要！）
        for (let y = 0; y < BOARD_SIZE; y++) {
            let filled = board[y].filter(c => c !== 0).length;
            if (filled === BOARD_SIZE) score += this.weights.linesCleared;
            else if (filled >= 5) score += this.weights.almostComplete * (filled - 4);
        }
        for (let x = 0; x < BOARD_SIZE; x++) {
            let filled = 0;
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (board[y][x] !== 0) filled++;
            }
            if (filled === BOARD_SIZE) score += this.weights.linesCleared;
            else if (filled >= 5) score += this.weights.almostComplete * (filled - 4);
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

        // エッジ・コーナーボーナス
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (board[i][0] !== 0) score += this.weights.edgeBonus;
            if (board[i][BOARD_SIZE - 1] !== 0) score += this.weights.edgeBonus;
            if (board[0][i] !== 0) score += this.weights.edgeBonus;
            if (board[BOARD_SIZE - 1][i] !== 0) score += this.weights.edgeBonus;
        }

        return score;
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
        // 横
        for (let row = 0; row < BOARD_SIZE; row++) {
            if (newBoard[row].every(c => c !== 0)) {
                for (let col = 0; col < BOARD_SIZE; col++) newBoard[row][col] = 0;
                linesCleared++;
            }
        }
        // 縦
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

    findBestMove() {
        const moves = this.game.getValidMoves();
        if (moves.length === 0) return null;

        let bestMove = null;
        let bestScore = -Infinity;

        for (const move of moves) {
            const piece = this.game.pieces[move.pieceIndex];
            const result = this.simulateMove(this.game.board, piece, move.x, move.y);

            let moveScore = result.linesCleared * this.weights.linesCleared * 2;
            moveScore += this.evaluateBoard(result.board);
            
            const blockSize = piece.shape.flat().filter(c => c).length;
            moveScore += blockSize * this.weights.bigPieceFirst;

            if (moveScore > bestScore) {
                bestScore = moveScore;
                bestMove = move;
            }
        }
        return bestMove;
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
        const score = this.game.score;
        this.gamesPlayed++;
        this.totalScore += score;
        if (score > this.bestScore) this.bestScore = score;
    }
}

class MultiAgentAI {
    constructor() {
        this.container = document.getElementById('gamesContainer');
        this.agents = [];
        this.games = [];
        this.agentCount = 4;
        this.isRunning = false;
        this.speed = 50;
        this.generation = 1;
        this.totalGames = 0;
        this.bestScore = 0;
        this.bestWeights = null;
        this.allTimeScores = [];
        this.generationScores = [];

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
            if (this.bestWeights && Math.random() < 0.7) {
                agent.copyFrom({ weights: this.bestWeights });
                agent.mutate(0.5, 0.3);
            }
            this.agents.push(agent);
        }
        this.updateAgentLabels();
    }

    updateAgentLabels() {
        this.agents.forEach((agent, i) => {
            const label = this.games[i].element.querySelector('.agent-name');
            label.textContent = `AI ${i + 1}`;
        });
    }

    loadData() {
        const saved = localStorage.getItem('blockBlastAI_v4');
        if (saved) {
            const data = JSON.parse(saved);
            this.generation = data.generation || 1;
            this.totalGames = data.totalGames || 0;
            this.bestScore = data.bestScore || 0;
            this.bestWeights = data.bestWeights || null;
            this.allTimeScores = data.allTimeScores || [];
        }
    }

    saveData() {
        const data = {
            generation: this.generation,
            totalGames: this.totalGames,
            bestScore: this.bestScore,
            bestWeights: this.bestWeights,
            allTimeScores: this.allTimeScores.slice(-500)
        };
        localStorage.setItem('blockBlastAI_v4', JSON.stringify(data));
        if (cloudSync.user) cloudSync.save(data);
    }

    async loadFromCloud() {
        const data = await cloudSync.load();
        if (data && data.bestScore > this.bestScore) {
            this.generation = Math.max(this.generation, data.generation || 1);
            this.totalGames = Math.max(this.totalGames, data.totalGames || 0);
            this.bestScore = data.bestScore;
            this.bestWeights = data.bestWeights;
            this.updateStats();
            console.log('☁️ Synced better weights from cloud!');
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
        
        const recent = this.allTimeScores.slice(-50);
        const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
        document.getElementById('avgScore').textContent = avg;

        // 成長率表示
        const older = this.allTimeScores.slice(-100, -50);
        if (older.length > 0 && recent.length > 0) {
            const oldAvg = older.reduce((a, b) => a + b, 0) / older.length;
            const newAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const growth = ((newAvg - oldAvg) / oldAvg * 100).toFixed(1);
            document.getElementById('growth').textContent = (growth >= 0 ? '+' : '') + growth + '%';
            document.getElementById('growth').style.color = growth >= 0 ? '#1dd1a1' : '#ff6b6b';
        }
    }

    onAgentGameOver(agentIndex) {
        const agent = this.agents[agentIndex];
        const score = this.games[agentIndex].score;
        
        agent.onGameOver();
        this.totalGames++;
        this.allTimeScores.push(score);
        this.generationScores.push({ agent: agentIndex, score });

        // ベスト更新
        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestWeights = { ...agent.weights };
            console.log(`🏆 New best: ${score} by AI ${agentIndex + 1}`);
            this.showBestNotification(agentIndex, score);
        }

        // 世代交代チェック（全員が一定回数プレイしたら）
        const minGames = Math.min(...this.agents.map(a => a.gamesPlayed));
        if (minGames > 0 && minGames % 3 === 0 && this.generationScores.length >= this.agentCount * 3) {
            this.evolveGeneration();
        }

        // 即座にリスタート
        this.games[agentIndex].init();
        
        // 定期保存
        if (this.totalGames % 10 === 0) {
            this.saveData();
            this.updateStats();
        }
    }

    showBestNotification(agentIndex, score) {
        const el = this.games[agentIndex].element;
        el.style.boxShadow = '0 0 20px #feca57';
        setTimeout(() => el.style.boxShadow = '', 1000);
    }

    evolveGeneration() {
        // 平均スコアでソート
        const ranked = this.agents
            .map((a, i) => ({ agent: a, index: i, avg: a.avgScore }))
            .sort((a, b) => b.avg - a.avg);

        console.log(`📊 Gen ${this.generation} - Avg scores:`, ranked.map(r => r.avg));

        // 下位半分を上位の変異コピーで置き換え
        const survivors = Math.ceil(this.agents.length / 2);
        for (let i = survivors; i < this.agents.length; i++) {
            const parent = ranked[i % survivors].agent;
            this.agents[ranked[i].index].copyFrom(parent);
            this.agents[ranked[i].index].mutate(0.5, 0.35);
            // 統計リセット
            this.agents[ranked[i].index].gamesPlayed = 0;
            this.agents[ranked[i].index].totalScore = 0;
        }

        // ベストの遺伝子を少し混ぜる
        if (this.bestWeights) {
            this.agents.forEach(a => {
                for (const key in a.weights) {
                    if (Math.random() < 0.1) {
                        a.weights[key] = this.bestWeights[key] * (0.9 + Math.random() * 0.2);
                    }
                }
            });
        }

        this.generation++;
        this.generationScores = [];
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
            await this.sleep(this.speed);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const multiAI = new MultiAgentAI();
