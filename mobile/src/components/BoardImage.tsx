import { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';

import type { PlayerColor } from '../types';

type Props = {
  fen: string | null;
  orientation: PlayerColor;
  primaryMove: string;
  responseMove: string;
  showBoard: boolean;
  loading: boolean;
  waiting: boolean;
};

type PieceCode = keyof typeof PIECES;

const PIECES = {
  bb: require('../../assets/chess-pieces/bb.png'),
  bk: require('../../assets/chess-pieces/bk.png'),
  bn: require('../../assets/chess-pieces/bn.png'),
  bp: require('../../assets/chess-pieces/bp.png'),
  bq: require('../../assets/chess-pieces/bq.png'),
  br: require('../../assets/chess-pieces/br.png'),
  wb: require('../../assets/chess-pieces/wb.png'),
  wk: require('../../assets/chess-pieces/wk.png'),
  wn: require('../../assets/chess-pieces/wn.png'),
  wp: require('../../assets/chess-pieces/wp.png'),
  wq: require('../../assets/chess-pieces/wq.png'),
  wr: require('../../assets/chess-pieces/wr.png'),
} satisfies Record<string, ImageSourcePropType>;

const PIECE_TYPE: Record<string, string> = {
  b: 'b', k: 'k', n: 'n', p: 'p', q: 'q', r: 'r',
};

function parseFen(fen: string): Array<PieceCode | null> {
  const squares: Array<PieceCode | null> = [];
  for (const rank of (fen.split(' ')[0] ?? '').split('/')) {
    for (const token of rank) {
      if (/\d/.test(token)) {
        for (let empty = 0; empty < Number(token); empty += 1) squares.push(null);
      } else {
        const color = token === token.toUpperCase() ? 'w' : 'b';
        squares.push(`${color}${PIECE_TYPE[token.toLowerCase()]}` as PieceCode);
      }
    }
  }
  return squares.length === 64 ? squares : Array(64).fill(null);
}

function parseMove(move: string): [string, string] | null {
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  return /^[a-h][1-8]$/.test(from) && /^[a-h][1-8]$/.test(to) ? [from, to] : null;
}

function squareCenter(square: string, orientation: PlayerColor): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return [(column + 0.5) * 12.5, (row + 0.5) * 12.5];
}

function MoveArrow({ move, color, orientation }: {
  move: string;
  color: string;
  orientation: PlayerColor;
}) {
  const parsed = parseMove(move);
  if (!parsed) return null;
  const [startX, startY] = squareCenter(parsed[0], orientation);
  const [endX, endY] = squareCenter(parsed[1], orientation);
  const angle = Math.atan2(endY - startY, endX - startX);
  const tipX = endX - Math.cos(angle) * 2.2;
  const tipY = endY - Math.sin(angle) * 2.2;
  const wing = 2.4;
  const back = 5;
  const points = [
    `${endX},${endY}`,
    `${endX - Math.cos(angle) * back + Math.sin(angle) * wing},${endY - Math.sin(angle) * back - Math.cos(angle) * wing}`,
    `${endX - Math.cos(angle) * back - Math.sin(angle) * wing},${endY - Math.sin(angle) * back + Math.cos(angle) * wing}`,
  ].join(' ');
  return (
    <>
      <Line x1={startX} y1={startY} x2={tipX} y2={tipY} stroke={color} strokeWidth="1.45" strokeLinecap="round" />
      <Polygon points={points} fill={color} />
    </>
  );
}

export function BoardImage({ fen, orientation, primaryMove, responseMove, showBoard, loading, waiting }: Props) {
  const opacity = useRef(new Animated.Value(1)).current;
  const pieces = useMemo(() => (fen ? parseFen(fen) : []), [fen]);
  const displayedPieces = orientation === 'white' ? pieces : [...pieces].reverse();

  useEffect(() => {
    opacity.setValue(0.72);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [fen, opacity]);

  if (!showBoard || !fen) {
    return (
      <View style={styles.frame}>
        <View style={styles.placeholder}>
          {loading && <ActivityIndicator color="#7DD3FC" />}
          <Text style={styles.placeholderTitle}>{waiting ? 'Waiting for your opponent' : 'Board preview'}</Text>
          <Text style={styles.placeholderCopy}>
            {waiting ? 'The next recommendation will appear on your turn.' : 'The analyzed position will appear after the first engine result.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <Animated.View style={[styles.board, { opacity }]}>
        {displayedPieces.map((piece, index) => {
          const sourceIndex = orientation === 'white' ? index : 63 - index;
          const row = Math.floor(sourceIndex / 8);
          const column = sourceIndex % 8;
          return (
            <View key={index} style={[styles.square, (row + column) % 2 === 0 ? styles.light : styles.dark]}>
              {piece && <Image source={PIECES[piece]} style={styles.piece} resizeMode="contain" fadeDuration={0} />}
            </View>
          );
        })}
      </Animated.View>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" pointerEvents="none">
        <MoveArrow move={responseMove} color="rgba(232, 93, 74, 0.9)" orientation={orientation} />
        <MoveArrow move={primaryMove} color="rgba(40, 120, 213, 0.92)" orientation={orientation} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#111B2E', borderWidth: 1, borderColor: '#24314A' },
  board: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  square: { width: '12.5%', height: '12.5%', alignItems: 'center', justifyContent: 'center' },
  light: { backgroundColor: '#EED9B5' },
  dark: { backgroundColor: '#B58863' },
  piece: { width: '88%', height: '88%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  placeholderTitle: { color: '#E8EDF7', fontSize: 18, fontWeight: '700' },
  placeholderCopy: { color: '#8D9AB1', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
