// Firebase設定
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
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
        if (this.user) {
            await firebase.auth().signOut();
        } else {
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebase.auth().signInWithPopup(provider);
        }
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

// AIエージェント
class AIAgent {
    constructor(id, game) {
        this.id = id;
        this.game = game;
        this.weights = this.randomWeights();
        this.totalReward = 0;
    }

    randomWeights() {
        return {
            linesCleared: 50 + Math.random() * 100,
            emptySpaces: Math.random() * 3,
            almostComplete: 5 + Math.random() * 10,
            holes: -1 - Math.random() * 5,
            edgeBonus: Math.random() * 2,
            bigPieceFirst: Math.random() * 3
        };
    }

    clone() {
        const agent = new AIAgent(this.id, this.game);
        agent.weights = { ...this.weights };
        agent.totalReward = this.totalReward;
        return agent;
    }

    mutate(rate = 0.4, amount = 0.3) {
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

    findBestMove() {
        const moves = this.game.getValidMoves();
        if (moves.length === 0) return null;

        let bestMove = null;
        let bestScore = -Infinity;

        for (const move of moves) {
            const piece = this.game.pieces[move.pieceIndex];
            const result = this.simulateMove(this.game.board, piece, move.x, move.y);

            let moveScore = result.linesCleared * this.weights.linesCleared;
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
}

// マルチエージェント管理
class MultiAgentAI {
    constructor() {
        this.container = document.getElementById('gamesContainer');
        this.agents = [];
        this.games = [];
        this.agentCount = 3;
        this.isRunning = false;
        this.speed = 100;
        this.generation = 1;
        this.totalGames = 0;
        this.bestScore = 0;
        this.bestWeights = null;
        this.recentScores = [];

        this.loadData();
        this.createAgents();
        this.setupUI();
        this.updateStats();
        cloudSync.init();
    }

    createAgents() {
        // 既存を削除
        this.games.forEach(g => g.destroy());
        this.games = [];
        this.agents = [];

        for (let i = 0; i < this.agentCount; i++) {
            const game = new BlockBlastGame(this.container, i, false);
            this.games.push(game);
            
            const agent = new AIAgent(i, game);
            // ベストの重みがあれば継承
            if (this.bestWeights) {
                agent.weights = { ...this.bestWeights };
                agent.mutate(0.5, 0.3);
            }
            this.agents.push(agent);
        }
    }

    loadData() {
        const saved = localStorage.getItem('blockBlastMultiAI3');
        if (saved) {
            const data = JSON.parse(saved);
            this.generation = data.generation || 1;
            this.totalGames = data.totalGames || 0;
            this.bestScore = data.bestScore || 0;
            this.bestWeights = data.bestWeights || null;
            this.recentScores = data.recentScores || [];
        }
    }

    saveData() {
        const data = {
            generation: this.generation,
            totalGames: this.totalGames,
            bestScore: this.bestScore,
            bestWeights: this.bestWeights,
            recentScores: this.recentScores.slice(-100)
        };
        localStorage.setItem('blockBlastMultiAI3', JSON.stringify(data));
        if (cloudSync.user) cloudSync.save(data);
    }

    async loadFromCloud() {
        const data = await cloudSync.load();
        if (data && data.generation > this.generation) {
            this.generation = data.generation;
            this.totalGames = data.totalGames;
            this.bestScore = data.bestScore;
            this.bestWeights = data.bestWeights;
            this.recentScores = data.recentScores || [];
            this.updateStats();
            // エージェントに反映
            this.agents.forEach(a => {
                if (this.bestWeights) {
                    a.weights = { ...this.bestWeights };
                    a.mutate(0.3, 0.2);
                }
            });
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
        
        const avg = this.recentScores.length > 0
            ? Math.round(this.recentScores.reduce((a, b) => a + b, 0) / this.recentScores.length)
            : 0;
        document.getElementById('avgScore').textContent = avg;
    }

    evolve() {
        // 全エージェントのスコアを収集
        const scores = this.agents.map((a, i) => ({
            agent: a,
            score: this.games[i].score
        }));

        // スコア記録
        scores.forEach(s => {
            this.recentScores.push(s.score);
            this.totalGames++;
            
            // 報酬計算（高スコアほど指数的に増加）
            const reward = Math.pow(s.score / 50, 1.5);
            s.agent.totalReward += reward;

            // ベスト更新
            if (s.score > this.bestScore) {
                this.bestScore = s.score;
                this.bestWeights = { ...s.agent.weights };
                console.log(`🏆 New best: ${s.score} by AI ${s.agent.id + 1}`);
            }
        });

        if (this.recentScores.length > 100) {
            this.recentScores = this.recentScores.slice(-100);
        }

        // 報酬でソート
        scores.sort((a, b) => b.agent.totalReward - a.agent.totalReward);

        // 上位半分の遺伝子を下位に継承
        const survivors = Math.ceil(this.agents.length / 2);
        for (let i = survivors; i < this.agents.length; i++) {
            const parent = scores[i % survivors].agent;
            this.agents[i].weights = { ...parent.weights };
            this.agents[i].mutate(0.5, 0.3);
            this.agents[i].totalReward = 0;
        }

        // ベストの遺伝子も混ぜる
        if (this.bestWeights) {
            this.agents.forEach(a => {
                for (const key in a.weights) {
                    if (Math.random() < 0.15) {
                        a.weights[key] = this.bestWeights[key];
                    }
                }
            });
        }

        // 上位の報酬を減衰
        for (let i = 0; i < survivors; i++) {
            scores[i].agent.totalReward *= 0.5;
        }

        this.generation++;
        this.saveData();
        this.updateStats();

        // ゲームリセット
        this.games.forEach(g => g.init());
    }

    async run() {
        while (this.isRunning) {
            // 全エージェントが1手ずつ
            let allDone = true;
            for (let i = 0; i < this.agents.length; i++) {
                if (!this.games[i].gameOver) {
                    this.agents[i].step();
                    allDone = false;
                }
            }

            // 全員ゲームオーバーなら進化
            if (allDone) {
                this.evolve();
                await this.sleep(300);
            }

            await this.sleep(this.speed);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const multiAI = new MultiAgentAI();
