// Block Blast Game
const BOARD_SIZE = 8;
const CELL_SIZE = 30;
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
    constructor(container, id, isManual = false) {
        this.id = id;
        this.isManual = isManual;
        this.container = container;
        
        this.createDOM();
        this.board = [];
        this.pieces = [];
        this.selectedPiece = null;
        this.score = 0;
        this.gameOver = false;
        this.dragging = false;
        this.dragPieceIndex = null;
        this.hoverX = -1;
        this.hoverY = -1;
        
        this.init();
        if (isManual) this.setupEventListeners();
    }

    createDOM() {
        const div = document.createElement('div');
        div.className = 'game-instance';
        div.innerHTML = `
            <div class="header">
                <span class="agent-name">${this.isManual ? 'あなた' : 'AI ' + (this.id + 1)}</span>
                <span class="score-display">Score: <span class="score">0</span></span>
            </div>
            <canvas width="${BOARD_SIZE * CELL_SIZE}" height="${BOARD_SIZE * CELL_SIZE}"></canvas>
            <div class="pieces-row"></div>
        `;
        this.container.appendChild(div);
        
        this.element = div;
        this.canvas = div.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.piecesContainer = div.querySelector('.pieces-row');
        this.scoreElement = div.querySelector('.score');
    }

    init() {
        this.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
        this.score = 0;
        this.gameOver = false;
        this.selectedPiece = null;
        this.dragging = false;
        this.hoverX = -1;
        this.hoverY = -1;
        this.generatePieces();
        this.updateScore();
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
        this.piecesContainer.innerHTML = '';
        const blockSize = 18;

        this.pieces.forEach((piece, index) => {
            if (piece.used) return;

            const canvas = document.createElement('canvas');
            canvas.className = 'piece-canvas';
            canvas.width = piece.shape[0].length * blockSize + 6;
            canvas.height = piece.shape.length * blockSize + 6;
            canvas.dataset.index = index;

            const ctx = canvas.getContext('2d');
            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell) {
                        ctx.fillStyle = piece.color;
                        ctx.fillRect(x * blockSize + 3, y * blockSize + 3, blockSize - 2, blockSize - 2);
                    }
                });
            });

            if (this.isManual) {
                canvas.addEventListener('mousedown', (e) => {
                    if (this.gameOver) return;
                    this.startDrag(index);
                });
            }

            this.piecesContainer.appendChild(canvas);
        });
    }

    startDrag(pieceIndex) {
        if (this.pieces[pieceIndex].used) return;
        this.dragging = true;
        this.dragPieceIndex = pieceIndex;
        this.selectedPiece = pieceIndex;
        document.body.style.cursor = 'grabbing';
        
        this.piecesContainer.querySelectorAll('.piece-canvas').forEach((c) => {
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

        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]) {
                    this.board[boardY + y][boardX + x] = piece.color;
                }
            }
        }

        piece.used = true;
        this.selectedPiece = null;
        this.dragging = false;
        this.hoverX = -1;
        this.hoverY = -1;

        const blockCount = piece.shape.flat().filter(c => c).length;
        this.score += blockCount;

        this.clearLines();

        if (this.pieces.every(p => p.used)) {
            this.generatePieces();
        } else {
            this.renderPieces();
        }

        if (this.checkGameOver()) {
            this.gameOver = true;
        }

        this.updateScore();
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

    updateScore() {
        this.scoreElement.textContent = this.score;
    }

    render() {
        const ctx = this.ctx;
        ctx.fillStyle = '#0f0f23';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // グリッド
        ctx.strokeStyle = '#1a1a3e';
        ctx.lineWidth = 1;
        for (let i = 0; i <= BOARD_SIZE; i++) {
            ctx.beginPath();
            ctx.moveTo(i * CELL_SIZE, 0);
            ctx.lineTo(i * CELL_SIZE, BOARD_SIZE * CELL_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * CELL_SIZE);
            ctx.lineTo(BOARD_SIZE * CELL_SIZE, i * CELL_SIZE);
            ctx.stroke();
        }

        // 配置済みブロック
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (this.board[y][x]) {
                    ctx.fillStyle = this.board[y][x];
                    ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                }
            }
        }

        // プレビュー
        if (this.dragging && this.dragPieceIndex !== null && this.hoverX >= 0) {
            const piece = this.pieces[this.dragPieceIndex];
            const canPlace = this.canPlace(piece, this.hoverX, this.hoverY);
            
            piece.shape.forEach((row, py) => {
                row.forEach((cell, px) => {
                    if (cell) {
                        const bx = this.hoverX + px;
                        const by = this.hoverY + py;
                        if (bx >= 0 && bx < BOARD_SIZE && by >= 0 && by < BOARD_SIZE) {
                            ctx.fillStyle = canPlace ? piece.color + '80' : '#ff000060';
                            ctx.fillRect(bx * CELL_SIZE + 1, by * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                        }
                    }
                });
            });
        }

        // ゲームオーバー
        if (this.gameOver) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = '#ff6b6b';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    getBoardCoords(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left) / CELL_SIZE);
        const y = Math.floor((clientY - rect.top) / CELL_SIZE);
        return { x, y };
    }

    setupEventListeners() {
        document.addEventListener('mousemove', (e) => {
            if (!this.dragging || this.dragPieceIndex === null) return;
            
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

    destroy() {
        this.element.remove();
    }
}
