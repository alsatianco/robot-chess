// Lesson data for the interactive tutorial. This file holds data only: the tutorial runner reads it, and every text is an i18n key that lives in src/i18n/en.js (under the top-level key "tutorial").
// The player always plays White (cyan lights) with White at the bottom. Every position has both kings because chess.js refuses a FEN without them; the king that the lesson does not need is parked in a far corner where it is never in check and never in the way.
// Moves are written in UCI ("a1a8", promotion as "e7e8q"). The texts never show chess notation to the child; they say "the glowing square", and the runner makes the `hint` squares glow.
// String keys follow one pattern: tutorial.<lesson id>.<step id in camelCase>.<text | wrong | success>. The test in tests/tutorial/lessons.test.js checks this pattern and proves that every move in this file is legal.

/**
 * @typedef {'info' | 'good' | 'danger' | 'target'} MarkKind
 * @typedef {{ square: string, kind: MarkKind }} Highlight
 * @typedef {{ from: string, to: string, kind: MarkKind }} Arrow
 *
 * @typedef {object} InfoStep The child reads and presses Next.
 * @property {string} id Unique inside the lesson, kebab-case.
 * @property {'info'} kind
 * @property {string} fen Full FEN of the position to show.
 * @property {string} text i18n key.
 * @property {string[]} [demo] Legal UCI sequence from `fen` that the runner animates and then undoes.
 * @property {Highlight[]} [highlights]
 * @property {Arrow[]} [arrows]
 *
 * @typedef {object} MoveStep The child must play one of the accepted moves.
 * @property {string} id Unique inside the lesson, kebab-case.
 * @property {'move'} kind
 * @property {string} fen Full FEN. White is to move, or Black when `prelude` brings the turn back to White.
 * @property {string} text i18n key.
 * @property {string[]} accept UCI moves that complete the step.
 * @property {{ from: string, to: string }} hint Squares that glow; always one of the accepted moves.
 * @property {string} wrong i18n key shown after any other attempt.
 * @property {string} success i18n key shown after an accepted move.
 * @property {string[]} [prelude] Scripted UCI moves played from `fen` before the child acts.
 * @property {string} [reply] One scripted opponent move played after the child's move.
 * @property {Highlight[]} [highlights]
 * @property {Arrow[]} [arrows]
 *
 * @typedef {InfoStep | MoveStep} Step
 * @typedef {{ id: string, title: string, steps: Step[] }} Lesson
 */

/** @type {Lesson[]} */
export const lessons = [
  // Chapter 1: the board and the goal of the game.
  {
    id: 'board',
    title: 'tutorial.board.title',
    steps: [
      {
        id: 'squares',
        kind: 'info',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'tutorial.board.squares.text',
      },
      {
        // The demo shows one move by each team, so the child sees what "taking turns" means.
        id: 'turns',
        kind: 'info',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'tutorial.board.turns.text',
        demo: ['e2e4', 'e7e5'],
      },
      {
        id: 'goal',
        kind: 'info',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'tutorial.board.goal.text',
        highlights: [
          { square: 'e1', kind: 'info' },
          { square: 'e8', kind: 'target' },
        ],
      },
    ],
  },

  // Chapter 2: one step per piece. Every piece starts on its home square where that helps, and no accepted move gives check, so nothing distracts from how the piece moves.
  {
    id: 'pieces',
    title: 'tutorial.pieces.title',
    steps: [
      {
        id: 'rook',
        kind: 'move',
        fen: '7k/8/8/8/8/8/8/R3K3 w - - 0 1',
        text: 'tutorial.pieces.rook.text',
        accept: ['a1a6'],
        hint: { from: 'a1', to: 'a6' },
        wrong: 'tutorial.pieces.rook.wrong',
        success: 'tutorial.pieces.rook.success',
      },
      {
        // The black pawn next to the parked king is there only so that this is a normal position: a king and a bishop against a bare king is already a draw by the rules ("not enough pieces"), and a board that reports "game over" could block the lesson.
        id: 'bishop',
        kind: 'move',
        fen: '7k/7p/8/8/8/8/8/2B1K3 w - - 0 1',
        text: 'tutorial.pieces.bishop.text',
        accept: ['c1g5'],
        hint: { from: 'c1', to: 'g5' },
        wrong: 'tutorial.pieces.bishop.wrong',
        success: 'tutorial.pieces.bishop.success',
      },
      {
        id: 'queen',
        kind: 'move',
        fen: '7k/8/8/8/8/8/8/3QK3 w - - 0 1',
        text: 'tutorial.pieces.queen.text',
        accept: ['d1a4'],
        hint: { from: 'd1', to: 'a4' },
        wrong: 'tutorial.pieces.queen.wrong',
        success: 'tutorial.pieces.queen.success',
      },
      {
        // The knight stands behind its own pawns, so the jump over another robot is real. The two arrows draw the L shape: two squares straight, then one to the side.
        id: 'knight',
        kind: 'move',
        fen: '7k/8/8/8/8/8/5PPP/4K1N1 w - - 0 1',
        text: 'tutorial.pieces.knight.text',
        accept: ['g1f3'],
        hint: { from: 'g1', to: 'f3' },
        wrong: 'tutorial.pieces.knight.wrong',
        success: 'tutorial.pieces.knight.success',
        arrows: [
          { from: 'g1', to: 'g3', kind: 'info' },
          { from: 'g3', to: 'f3', kind: 'info' },
        ],
      },
      {
        // The king stands in the middle of the board and every one of its eight steps is accepted, so the child feels that "one step in any direction" is a free choice. The hint is only a suggestion here, and it points to the side: the king is tall, so on screen it covers the square right behind it, and a tap there would land on the king's own head. The black pawn keeps the position from being a "not enough pieces" draw, as in the bishop step.
        id: 'king',
        kind: 'move',
        fen: '7k/7p/8/8/4K3/8/8/8 w - - 0 1',
        text: 'tutorial.pieces.king.text',
        accept: ['e4e5', 'e4d5', 'e4f5', 'e4d4', 'e4f4', 'e4d3', 'e4e3', 'e4f3'],
        hint: { from: 'e4', to: 'f4' },
        wrong: 'tutorial.pieces.king.wrong',
        success: 'tutorial.pieces.king.success',
      },
      {
        // This pawn has already left its home square, so one step is its only move and the child cannot mix it up with the double step of the next step.
        id: 'pawn-step',
        kind: 'move',
        fen: '7k/8/8/8/8/3P4/4P3/4K3 w - - 0 1',
        text: 'tutorial.pieces.pawnStep.text',
        accept: ['d3d4'],
        hint: { from: 'd3', to: 'd4' },
        wrong: 'tutorial.pieces.pawnStep.wrong',
        success: 'tutorial.pieces.pawnStep.success',
      },
      {
        // Same board as the step before, one move later. The second pawn is still on its home square and takes the double step.
        id: 'pawn-double',
        kind: 'move',
        fen: '7k/8/8/8/3P4/8/4P3/4K3 w - - 0 1',
        text: 'tutorial.pieces.pawnDouble.text',
        accept: ['e2e4'],
        hint: { from: 'e2', to: 'e4' },
        wrong: 'tutorial.pieces.pawnDouble.wrong',
        success: 'tutorial.pieces.pawnDouble.success',
      },
    ],
  },

  // Chapter 3: capturing. One normal capture, then the pawn, which is the only piece that captures in a different way from how it moves.
  {
    id: 'capture',
    title: 'tutorial.capture.title',
    steps: [
      {
        // The same rook move as in chapter 2, but now a black robot stands on the target square.
        id: 'rook-capture',
        kind: 'move',
        fen: '7k/8/n7/8/8/8/8/R3K3 w - - 0 1',
        text: 'tutorial.capture.rookCapture.text',
        accept: ['a1a6'],
        hint: { from: 'a1', to: 'a6' },
        wrong: 'tutorial.capture.rookCapture.wrong',
        success: 'tutorial.capture.rookCapture.success',
      },
      {
        // The black pawn straight ahead blocks the white pawn and cannot be captured; the black knight on the diagonal can. The diagonal capture is the only pawn move in this position.
        id: 'pawn-capture',
        kind: 'move',
        fen: '7k/8/8/3np3/4P3/8/8/4K3 w - - 0 1',
        text: 'tutorial.capture.pawnCapture.text',
        accept: ['e4d5'],
        hint: { from: 'e4', to: 'd5' },
        wrong: 'tutorial.capture.pawnCapture.wrong',
        success: 'tutorial.capture.pawnCapture.success',
      },
    ],
  },

  // Chapter 4: check and checkmate. The child first sees a check, gets out of it, then gives a check that the king can escape, and last gives the same check where the king cannot escape.
  {
    id: 'check',
    title: 'tutorial.check.title',
    steps: [
      {
        id: 'in-check',
        kind: 'info',
        fen: 'k3r3/p7/8/7B/8/8/8/4K3 w - - 0 1',
        text: 'tutorial.check.inCheck.text',
        arrows: [{ from: 'e8', to: 'e1', kind: 'danger' }],
      },
      {
        // All three ways out of check exist here: the king steps away, the bishop blocks, or the bishop captures the rook. Every legal move is accepted, because every legal move in check is a correct answer; the hint shows the capture. The black pawn makes sure the game goes on after the bishop takes the rook, instead of ending as a "not enough pieces" draw.
        id: 'escape-check',
        kind: 'move',
        fen: 'k3r3/p7/8/7B/8/8/8/4K3 w - - 0 1',
        text: 'tutorial.check.escapeCheck.text',
        accept: ['h5e8', 'h5e2', 'e1d1', 'e1d2', 'e1f1', 'e1f2'],
        hint: { from: 'h5', to: 'e8' },
        wrong: 'tutorial.check.escapeCheck.wrong',
        success: 'tutorial.check.escapeCheck.success',
        arrows: [{ from: 'e8', to: 'e1', kind: 'danger' }],
      },
      {
        // A check that is not checkmate: the scripted reply shows the black king stepping away.
        id: 'give-check',
        kind: 'move',
        fen: '6k1/8/8/8/8/8/8/R5K1 w - - 0 1',
        text: 'tutorial.check.giveCheck.text',
        accept: ['a1a8'],
        hint: { from: 'a1', to: 'a8' },
        wrong: 'tutorial.check.giveCheck.wrong',
        success: 'tutorial.check.giveCheck.success',
        reply: 'g8g7',
      },
      {
        // The same rook move as the step before. The only change is the three black pawns, which now take away the king's way out, so the child sees what turns a check into checkmate.
        id: 'checkmate',
        kind: 'move',
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        text: 'tutorial.check.checkmate.text',
        accept: ['a1a8'],
        hint: { from: 'a1', to: 'a8' },
        wrong: 'tutorial.check.checkmate.wrong',
        success: 'tutorial.check.checkmate.success',
        highlights: [
          { square: 'f7', kind: 'info' },
          { square: 'g7', kind: 'info' },
          { square: 'h7', kind: 'info' },
        ],
      },
    ],
  },

  // Chapter 5: the three special moves. The child performs each one.
  {
    id: 'special',
    title: 'tutorial.special.title',
    steps: [
      {
        id: 'castling',
        kind: 'move',
        fen: '7k/8/8/8/8/8/5PPP/4K2R w K - 0 1',
        text: 'tutorial.special.castling.text',
        accept: ['e1g1'],
        hint: { from: 'e1', to: 'g1' },
        wrong: 'tutorial.special.castling.wrong',
        success: 'tutorial.special.castling.success',
        highlights: [{ square: 'h1', kind: 'info' }],
      },
      {
        // Only the queen promotion is accepted; the runner picks the queen by itself in this step. The black king is parked off the last row so the new queen does not give check.
        id: 'promotion',
        kind: 'move',
        fen: '8/2P4k/8/8/8/8/8/4K3 w - - 0 1',
        text: 'tutorial.special.promotion.text',
        accept: ['c7c8q'],
        hint: { from: 'c7', to: 'c8' },
        wrong: 'tutorial.special.promotion.wrong',
        success: 'tutorial.special.promotion.success',
      },
      {
        // The FEN has Black to move. The prelude plays the black pawn's double step, which is what makes en passant legal, and then the child captures. The highlight marks the square where the black pawn lands, because the captured pawn is not on the square the white pawn moves to.
        id: 'en-passant',
        kind: 'move',
        fen: '7k/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
        text: 'tutorial.special.enPassant.text',
        prelude: ['d7d5'],
        accept: ['e5d6'],
        hint: { from: 'e5', to: 'd6' },
        wrong: 'tutorial.special.enPassant.wrong',
        success: 'tutorial.special.enPassant.success',
        highlights: [{ square: 'd5', kind: 'target' }],
      },
    ],
  },

  // Chapter 6: draws. The stalemate is shown first as a still picture, then the child goes back one move and finds the checkmate instead, so "avoid stalemate when you are winning" is something the child does, not only reads.
  {
    id: 'draws',
    title: 'tutorial.draws.title',
    steps: [
      {
        // A real stalemate, so this FEN has Black to move: the black king is not in check and has no legal move. It is an info step, so nobody has to move. The three highlighted squares are the ones the king cannot step on.
        id: 'stalemate',
        kind: 'info',
        fen: 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1',
        text: 'tutorial.draws.stalemate.text',
        highlights: [
          { square: 'a8', kind: 'info' },
          { square: 'a7', kind: 'danger' },
          { square: 'b7', kind: 'danger' },
          { square: 'b8', kind: 'danger' },
        ],
      },
      {
        // The position one move before the stalemate above. The queen stopping one square short gives the stalemate; going all the way to the last row is the only checkmate.
        id: 'avoid-stalemate',
        kind: 'move',
        fen: 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1',
        text: 'tutorial.draws.avoidStalemate.text',
        accept: ['c1c8'],
        hint: { from: 'c1', to: 'c8' },
        wrong: 'tutorial.draws.avoidStalemate.wrong',
        success: 'tutorial.draws.avoidStalemate.success',
      },
      {
        // Two kings alone: a real "not enough pieces" draw, shown while the text also names the draw by repeating the position.
        id: 'other-draws',
        kind: 'info',
        fen: '8/8/4k3/8/8/3K4/8/8 w - - 0 1',
        text: 'tutorial.draws.otherDraws.text',
      },
    ],
  },
];
