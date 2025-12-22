// Block Blast Game
const BOARD_SIZE = 8;
const CELL_SIZE = 40;
const COLORS = [
    '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
    '#54a0ff', '#5f27cd', '#00d2d3', '#1dd1a1'
];

const PIECE_SHAPES = [
    [[1]],
    [[1, 1]],
    [[1], [1]],
    [[1, 1, 1]],
    [[1], [1], [1]],
    [[1, 1], [1, 1]],
    [[1, 1, 1], [1, 0, 0]],
    [[1, 0, 0], [1, 1, 1]],
    [[0, 0, 1], [1, 1, 1]],
    [[1, 1, 1], [0, 0, 1]],
    [[1, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 1, 1]],
    [[1, 1], [1, 0]],
    [[1, 1], [0, 1]],
    [[1, 0], [1, 1]],
    [[0, 1], [1, 1]],
    [[1, 1, 1, 1]],
    [[1], [1], [1], [1]],
    [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
];

class BlockBlastGame {
    constructor() {
        this.canvas = document.getElementById('gameBoard');
        this.ctx = this.canvas.getContext('2d');
        this.board = [];
        this.pieces = [];
        this.selectedPiece = null;
        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('blockBlastHighScore')) || 0;
        this.gameOver = false;
        
        // ドラッグ状態
        this.dragging = false;
        this.dragPieceIndex = null;
        this.dragX = 0;
        this.dragY = 0;
        this.hoverX = -1;
        this.hoverY = -1;
        
        this.init();
        this.setupEventListeners();
    }

    init() {
        this.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
        this.score = 0;
        this.gameOver = false;
        this.selectedPiece = null;
        this.dragging = false;
        this.generatePieces();
        this.updateDisplay();
        this.render();
    }

    generatePieces() {
        this.pieces = [];
        for (let i = 0; i < 3; i++) {
            const shapeIndex = Math.floor(Math.random() * PIECE_SHAPES.length);
            const colorIndex = Math.floor(Math.random() * COLORS.length);
            this.pieces.push({
                shape: PIECE_SHAPES[shapeIndex],
                color: COLORS[colorIndex],
                used: false
            });
        }
        this.renderPieces();
    }

    renderPieces() {
        const container = document.getElementById('piecesContainer');
        container.innerHTML = '';
        const pieceBlockSize = 25;
        const canvasSize = 120;

        this.pieces.forEach((piece, index) => {
            if (piece.used) return;

            const canvas = document.createElement('canvas');
            canvas.className = 'piece-canvas';
            canvas.width = canvasSize;
            canvas.height = canvasSize;
            canvas.dataset.index = index;

            const ctx = canvas.getContext('2d');
            const offsetX = (canvasSize - piece.shape[0].length * pieceBlockSize) / 2;
            const offsetY = (canvasSize - piece.shape.length * pieceBlockSize) / 2;

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell) {
                        ctx.fillStyle = piece.color;
                        ctx.fillRect(offsetX + x * pieceBlockSize, offsetY + y * pieceBlockSize, pieceBlockSize - 2, pieceBlockSize - 2);
                        ctx.fillStyle = 'rgba(255,255,255,0.3)';
                        ctx.fillRect(offsetX + x * pieceBlockSize, offsetY + y * pieceBlockSize, pieceBlockSize - 2, 4);
                    }
                });
            });

            // マウスダウンでドラッグ開始
            canvas.addEventListener('mousedown', (e) => {
                if (this.gameOver) return;
                this.startDrag(index, e.clientX, e.clientY);
            });

            container.appendChild(canvas);
        });
    }

    startDrag(pieceIndex, clientX, clientY) {
        if (this.pieces[pieceIndex].used) return;
        this.dragging = true;
        this.dragPieceIndex = pieceIndex;
        this.dragX = clientX;
        this.dragY = clientY;
        this.selectedPiece = pieceIndex;
        document.body.style.cursor = 'grabbing';
        
        document.querySelectorAll('.piece-canvas').forEach((c) => {
            c.classList.toggle('selected', parseInt(c.dataset.index) === pieceIndex);
        });
    }

    canPlace(piece, boardX, boardY) {
        const shape = piece.shape;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    const bx = boardX + x;
                    const by = boardY + y;
                    if (bx < 0 || bx >= BOARD_SIZE || by < 0 || by >= BOARD_SIZE) return false;
                    if (this.board[by][bx] !== 0) return false;
                }
            }
        }
        return true;
    }

    placePiece(pieceIndex, boardX, boardY) {
        const piece = this.pieces[pieceIndex];
        if (!this.canPlace(piece, boardX, boardY)) return false;

        const shape = piece.shape;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    this.board[boardY + y][boardX + x] = piece.color;
                }
            }
        }

        piece.used = true;
        this.selectedPiece = null;
        this.dragging = false;
        this.hoverX = -1;
        this.hoverY = -1;

        let blockCount = shape.flat().filter(c => c).length;
        this.score += blockCount;

        this.clearLines();

        if (this.pieces.every(p => p.used)) {
            this.generatePieces();
        } else {
            this.renderPieces();
        }

        if (this.checkGameOver()) {
            this.gameOver = true;
            if (this.score > this.highScore) {
                this.highScore = this.score;
                localStorage.setItem('blockBlastHighScore', this.highScore);
            }
        }

        this.updateDisplay();
        this.render();
        return true;
    }

    clearLines() {
        let rowsToClear = [];
        let colsToClear = [];

        for (let y = 0; y < BOARD_SIZE; y++) {
            if (this.board[y].every(cell => cell !== 0)) rowsToClear.push(y);
        }

        for (let x = 0; x < BOARD_SIZE; x++) {
            let full = true;
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (this.board[y][x] === 0) { full = false; break; }
            }
            if (full) colsToClear.push(x);
        }

        rowsToClear.forEach(y => {
            for (let x = 0; x < BOARD_SIZE; x++) this.board[y][x] = 0;
        });

        colsToClear.forEach(x => {
            for (let y = 0; y < BOARD_SIZE; y++) this.board[y][x] = 0;
        });

        const linesCleared = rowsToClear.length + colsToClear.length;
        if (linesCleared > 0) this.score += linesCleared * linesCleared * 10;
    }

    checkGameOver() {
        for (const piece of this.pieces) {
            if (piece.used) continue;
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    if (this.canPlace(piece, x, y)) return false;
                }
            }
        }
        return true;
    }

    updateDisplay() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('highScore').textContent = this.highScore;
    }

    render() {
        this.ctx.fillStyle = '#0f0f23';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // グリッド
        this.ctx.strokeStyle = '#1a1a3e';
        for (let i = 0; i <= BOARD_SIZE; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * CELL_SIZE, 0);
            this.ctx.lineTo(i * CELL_SIZE, BOARD_SIZE * CELL_SIZE);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(0, i * CELL_SIZE);
            this.ctx.lineTo(BOARD_SIZE * CELL_SIZE, i * CELL_SIZE);
            this.ctx.stroke();
        }

        // 配置済みブロック
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (this.board[y][x]) {
                    this.ctx.fillStyle = this.board[y][x];
                    this.ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                    this.ctx.fillStyle = 'rgba(255,255,255,0.3)';
                    this.ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, 4);
                }
            }
        }

        // プレビュー表示（ドラッグ中）
        if (this.dragging && this.dragPieceIndex !== null && this.hoverX >= 0 && this.hoverY >= 0) {
            const piece = this.pieces[this.dragPieceIndex];
            const canPlace = this.canPlace(piece, this.hoverX, this.hoverY);
            
            piece.shape.forEach((row, py) => {
                row.forEach((cell, px) => {
                    if (cell) {
                        const bx = this.hoverX + px;
                        const by = this.hoverY + py;
                        if (bx >= 0 && bx < BOARD_SIZE && by >= 0 && by < BOARD_SIZE) {
                            this.ctx.fillStyle = canPlace ? piece.color + '80' : '#ff000050';
                            this.ctx.fillRect(bx * CELL_SIZE + 2, by * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                            if (canPlace) {
                                this.ctx.strokeStyle = piece.color;
                                this.ctx.lineWidth = 2;
                                this.ctx.strokeRect(bx * CELL_SIZE + 2, by * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                            }
                        }
                    }
                });
            });
        }

        // ゲームオーバー
        if (this.gameOver) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = '#ff6b6b';
            this.ctx.font = 'bold 24px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    getBoardCoords(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = Math.floor((clientX - rect.left) * scaleX / CELL_SIZE);
        const y = Math.floor((clientY - rect.top) * scaleY / CELL_SIZE);
        return { x, y };
    }

    setupEventListeners() {
        // マウス移動（ドラッグ中のプレビュー更新）
        document.addEventListener('mousemove', (e) => {
            if (!this.dragging || this.dragPieceIndex === null) return;
            
            this.dragX = e.clientX;
            this.dragY = e.clientY;
            
            const rect = this.canvas.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const coords = this.getBoardCoords(e.clientX, e.clientY);
                this.hoverX = coords.x;
                this.hoverY = coords.y;
            } else {
                this.hoverX = -1;
                this.hoverY = -1;
            }
            this.render();
        });

        // マウスアップ（ドロップ）
        document.addEventListener('mouseup', (e) => {
            if (!this.dragging || this.dragPieceIndex === null) return;
            
            document.body.style.cursor = 'default';
            
            const rect = this.canvas.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const coords = this.getBoardCoords(e.clientX, e.clientY);
                this.placePiece(this.dragPieceIndex, coords.x, coords.y);
            }
            
            this.dragging = false;
            this.dragPieceIndex = null;
            this.hoverX = -1;
            this.hoverY = -1;
            this.render();
        });

        document.getElementById('newGame').addEventListener('click', () => this.init());
    }

    // AI用
    selectPiece(index) {
        if (this.pieces[index].used) return;
        this.selectedPiece = index;
    }

    getValidMoves() {
        const moves = [];
        this.pieces.forEach((piece, pieceIndex) => {
            if (piece.used) return;
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    if (this.canPlace(piece, x, y)) moves.push({ pieceIndex, x, y });
                }
            }
        });
        return moves;
    }
}

const game = new BlockBlastGame();
