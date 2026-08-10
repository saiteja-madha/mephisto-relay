import { HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  background,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  resizable,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

import type { LiveAnalysisProps } from '../src/types';

const ChessAnalysisActivity = (
  props: LiveAnalysisProps,
  _environment: LiveActivityEnvironment,
) => {
  'widget';

  const ACCENT = '#38BDF8';
  const MUTED = '#94A3B8';
  const LIGHT_SQUARE = '#E7D4B5';
  const DARK_SQUARE = '#A87958';
  const PIECES: Record<string, string> = {
    K: 'wk', Q: 'wq', R: 'wr', B: 'wb', N: 'wn', P: 'wp',
    k: 'bk', q: 'bq', r: 'br', b: 'bb', n: 'bn', p: 'bp',
  };

  const position = props.fen.split(' ')[0] ?? '8/8/8/8/8/8/8/8';
  const cells: Array<{ piece: string; square: string; light: boolean }> = [];
  position.split('/').forEach((rank, row) => {
    let column = 0;
    Array.from(rank).forEach((token) => {
      if (token >= '1' && token <= '8') {
        const emptyCount = Number(token);
        for (let empty = 0; empty < emptyCount; empty += 1) {
          cells.push({
            piece: '',
            square: `${'abcdefgh'[column]}${8 - row}`,
            light: (row + column) % 2 === 0,
          });
          column += 1;
        }
      } else {
        cells.push({
          piece: token,
          square: `${'abcdefgh'[column]}${8 - row}`,
          light: (row + column) % 2 === 0,
        });
        column += 1;
      }
    });
  });
  const displayCells = props.playerColor === 'black' ? cells.slice().reverse() : cells;
  const fromSquare = props.bestMove.length >= 4 ? props.bestMove.slice(0, 2) : '';
  const toSquare = props.bestMove.length >= 4 ? props.bestMove.slice(2, 4) : '';

  const MiniBoard = ({ size = 13 }: { size?: number }) => (
    <VStack
      spacing={0}
      modifiers={[
        frame({ width: size * 8, height: size * 8, alignment: 'center' }),
        clipShape('roundedRectangle', 6),
      ]}>
      {Array.from({ length: 8 }, (_, row) => (
        <HStack key={`rank-${row}-${props.updatedAt}`} spacing={0}>
          {displayCells.slice(row * 8, row * 8 + 8).map((cell) => {
            const selected = cell.square === fromSquare || cell.square === toSquare;
            const squareColor = selected ? '#0284C7' : cell.light ? LIGHT_SQUARE : DARK_SQUARE;
            return (
              <ZStack
                key={`${cell.square}-${cell.piece}-${props.updatedAt}`}
                modifiers={[
                  frame({ width: size, height: size, alignment: 'center' }),
                  background(squareColor),
                ]}>
                {cell.piece ? (
                  <Image
                    assetName={PIECES[cell.piece]}
                    modifiers={[resizable(), frame({ width: size - 1, height: size - 1 })]}
                  />
                ) : null}
              </ZStack>
            );
          })}
        </HStack>
      ))}
    </VStack>
  );

  const MoveDetails = () => (
    <VStack alignment="leading" spacing={5}>
      <Text modifiers={[font({ size: 10 }), foregroundStyle(MUTED), lineLimit(1)]}>
        {props.bestMoveLabel}
      </Text>
      <Text modifiers={[font({ weight: 'bold', size: 19 }), foregroundStyle('#FFFFFF')]}>
        {props.bestMove}
      </Text>
      {props.responseMove ? (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 9 }), foregroundStyle(MUTED), lineLimit(1)]}>
            {props.responseLabel}
          </Text>
          <Text modifiers={[font({ weight: 'semibold', size: 13 }), foregroundStyle('#FCA5A5')]}>
            {props.responseMove}
          </Text>
        </VStack>
      ) : null}
    </VStack>
  );

  const statusIcon =
    props.phase === 'error'
      ? 'exclamationmark.triangle.fill'
      : props.turn === 'player'
        ? 'scope'
        : 'hourglass';

  return {
    banner: (
      <ZStack modifiers={[containerBackground('#08111F', 'widget'), clipShape('containerRelativeShape')]}>
        <VStack spacing={12} modifiers={[padding({ all: 16 })]}>
          <HStack spacing={7}>
            <Image systemName={statusIcon} size={14} color={ACCENT} />
            <Text modifiers={[font({ weight: 'semibold', size: 13 }), foregroundStyle('#FFFFFF')]}>
              {props.status}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 11 }), foregroundStyle(MUTED)]}>Game {props.gameId}</Text>
          </HStack>
          {props.showBoard ? (
            <HStack spacing={14}>
              <MiniBoard key={`banner-board-${props.updatedAt}`} size={15} />
              <MoveDetails />
              <Spacer />
            </HStack>
          ) : (
            <Text modifiers={[font({ size: 14 }), foregroundStyle(MUTED), padding({ vertical: 12 })]}>
              Monitoring continues in the background
            </Text>
          )}
        </VStack>
      </ZStack>
    ),
    compactLeading: (
      <Image
        systemName={statusIcon}
        size={14}
        color={props.turn === 'player' ? ACCENT : MUTED}
        modifiers={[padding({ leading: 4 })]}
      />
    ),
    compactTrailing: (
      <Text modifiers={[font({ weight: 'bold', size: 13 }), foregroundStyle('#FFFFFF')]}>
        {props.bestMove}
      </Text>
    ),
    minimal: <Image systemName={statusIcon} size={14} color={ACCENT} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 8 })]}>
        <Image systemName={statusIcon} size={14} color={ACCENT} />
        <Text modifiers={[font({ weight: 'semibold', size: 12 }), foregroundStyle('#FFFFFF')]}>
          {props.status}
        </Text>
      </HStack>
    ),
    expandedTrailing: (
      <Text
        modifiers={[
          font({ weight: 'bold', size: 17 }),
          foregroundStyle('#FFFFFF'),
          padding({ trailing: 8 }),
        ]}>
        {props.bestMove}
      </Text>
    ),
    expandedBottom: props.showBoard ? (
      <HStack spacing={12} modifiers={[padding({ top: 4, horizontal: 8 })]}>
        <MiniBoard key={`expanded-board-${props.updatedAt}`} size={11} />
        <MoveDetails />
        <Spacer />
      </HStack>
    ) : (
      <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED), padding({ all: 10 })]}>
        {props.status}
      </Text>
    ),
  };
};

export default createLiveActivity<LiveAnalysisProps>(
  'ChessAnalysisActivity',
  ChessAnalysisActivity,
);
