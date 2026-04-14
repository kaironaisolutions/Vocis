import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Typography, Spacing, BorderRadius } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { getSessions, deleteSession } from '../src/db/database';
import { Session } from '../src/types';

export default function HomeScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [])
  );

  async function loadSessions() {
    setLoading(true);
    const data = await getSessions();
    setSessions(data);
    setLoading(false);
  }

  function handleDeleteSession(session: Session) {
    Alert.alert(
      'Delete Session',
      `Delete this session with ${session.item_count} item${session.item_count !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSession(session.id);
            setSessions((prev) => prev.filter((s) => s.id !== session.id));
          },
        },
      ]
    );
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today, ${date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } else if (diffDays === 1) {
      return `Yesterday, ${date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } else {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  // Overall stats
  const totalItems = sessions.reduce((sum, s) => sum + s.item_count, 0);
  const totalValue = sessions.reduce((sum, s) => sum + s.total_value, 0);

  function renderSession({ item }: { item: Session }) {
    return (
      <TouchableOpacity
        onPress={() => router.push(`/session/${item.id}`)}
        onLongPress={() => handleDeleteSession(item)}
        activeOpacity={0.7}
      >
        <Card style={styles.sessionCard}>
          <View style={styles.sessionTop}>
            <Text style={styles.sessionDate}>{formatDate(item.created_at)}</Text>
            <Text style={styles.sessionPrice}>${item.total_value.toFixed(2)}</Text>
          </View>
          <View style={styles.sessionBottom}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
              </Text>
            </View>
            <Text style={styles.arrow}>{'>'}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Stats header */}
      {sessions.length > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{sessions.length}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{totalItems}</Text>
            <Text style={styles.statLabel}>Items</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: Colors.accent }]}>
              ${totalValue.toFixed(0)}
            </Text>
            <Text style={styles.statLabel}>Total Value</Text>
          </View>
        </View>
      )}

      {/* Session list or empty state */}
      {loading ? null : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>Vocis</Text>
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the button below to start logging inventory with your voice.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
              <Text style={styles.hint}>Long press to delete</Text>
            </View>
          }
        />
      )}

      {/* Start button */}
      <View style={styles.bottomAction}>
        <Button
          title="Start Logging"
          onPress={() => router.push('/record')}
          size="large"
          style={styles.startButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    ...Typography.heading2,
  },
  statLabel: {
    ...Typography.label,
    marginTop: Spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.border,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.heading3,
  },
  hint: {
    ...Typography.bodySmall,
    fontSize: 12,
    color: Colors.textMuted,
  },
  list: {
    paddingBottom: 120,
  },
  sessionCard: {
    marginBottom: Spacing.sm,
  },
  sessionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sessionDate: {
    ...Typography.body,
  },
  sessionPrice: {
    ...Typography.price,
    fontSize: 16,
  },
  sessionBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  badgeText: {
    ...Typography.bodySmall,
    fontSize: 12,
    fontWeight: '600',
  },
  arrow: {
    color: Colors.textMuted,
    fontSize: 18,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Typography.heading2,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.bodySmall,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomAction: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.md,
    right: Spacing.md,
  },
  startButton: {
    width: '100%',
  },
});
