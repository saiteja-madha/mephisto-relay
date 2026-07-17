(function (root) {
    'use strict';

    function getBoard() {
        return document.querySelector('.board') || document.querySelector('wc-chess-board');
    }

    function getMoveRecords() {
        let moves = document.querySelectorAll('.node');
        if (moves.length === 0) moves = document.querySelectorAll('.move-text-component');
        if (moves.length === 0) moves = document.querySelectorAll('.move-text');
        return moves;
    }

    function getPieces() {
        const board = getBoard();
        return board ? board.querySelectorAll('.piece') : [];
    }

    function getOrientation() {
        const topLeftCoord = document.querySelector('.coordinate-light')
            || document.querySelector('.coords-light');
        return topLeftCoord && topLeftCoord.innerHTML === '1' ? 'black' : 'white';
    }

    function readMoves() {
        const result = [];
        for (const moveWrapper of getMoveRecords()) {
            const move = moveWrapper.classList.contains('node')
                ? moveWrapper.lastElementChild
                : moveWrapper;
            if (!move) continue;

            let notation = move.innerText.trim();
            if (move.lastElementChild?.classList.contains('icon-font-chess')) {
                notation = move.lastElementChild.getAttribute('data-figurine') + notation;
            }
            notation = notation.replace(/\s+/g, '');
            if (notation) result.push(notation);
        }
        return result;
    }

    function readPieces() {
        const result = [];
        for (const piece of getPieces()) {
            const classes = Array.from(piece.classList);
            const colorType = classes.find(value => /^[wb][prnbqk]$/.test(value));
            const squareClass = classes.find(value => /^square-[1-8][1-8]$/.test(value));
            if (!colorType || !squareClass) continue;

            const digits = squareClass.substring('square-'.length);
            result.push({
                color: colorType[0],
                type: colorType[1],
                square: String.fromCharCode(96 + Number(digits[0])) + digits[1],
            });
        }
        return result;
    }

    function snapshot() {
        const board = getBoard();
        if (!board) return null;
        return {
            url: window.location.href,
            orientation: getOrientation(),
            moves: readMoves(),
            pieces: readPieces(),
            turn: readMoves().length % 2 === 0 ? 'white' : 'black',
            animating: board.getAttribute('data-test-animating') === 'true',
        };
    }

    root.MephistoChessComAdapter = {
        getBoard,
        getMoveRecords,
        getOrientation,
        getPieces,
        snapshot,
    };
})(window);
