import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/constants/theme';

const LICENSES = [
  {
    name: 'React Native',
    version: '0.81.x',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
  },
  {
    name: 'Expo',
    version: '54.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-router',
    version: '6.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-sqlite',
    version: '16.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-secure-store',
    version: '15.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-av',
    version: '15.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-file-system',
    version: '18.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-sharing',
    version: '13.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-mail-composer',
    version: '14.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'expo-local-authentication',
    version: '15.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).',
  },
  {
    name: 'papaparse',
    version: '5.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015 Matthew Holt.',
  },
  {
    name: '@react-native-async-storage/async-storage',
    version: '2.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present, Facebook, Inc.',
  },
  {
    name: 'react-native-reanimated',
    version: '4.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2016 Software Mansion.',
  },
  {
    name: 'react-native-gesture-handler',
    version: '2.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2016 Software Mansion.',
  },
  {
    name: 'react-native-screens',
    version: '4.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2018 Software Mansion.',
  },
  {
    name: 'react-native-safe-area-context',
    version: '5.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2019 Th3rd Wave.',
  },
  {
    name: 'SQLCipher',
    version: '4.x',
    license: 'BSD-3-Clause',
    copyright: 'Copyright (c) 2008-2024 Zetetic LLC.',
  },
];

export default function LicensesScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Open Source Licenses</Text>
      <Text style={styles.subtitle}>
        Vocis is built with the following open source software.
        We are grateful to the developers and communities behind these projects.
      </Text>

      {LICENSES.map((lib) => (
        <React.Fragment key={lib.name}>
          <Text style={styles.libName}>
            {lib.name} <Text style={styles.libVersion}>v{lib.version}</Text>
          </Text>
          <Text style={styles.libLicense}>{lib.license} License</Text>
          <Text style={styles.libCopyright}>{lib.copyright}</Text>
        </React.Fragment>
      ))}

      <Text style={styles.footer}>
        Full license texts are available in the source repository and in each
        package's node_modules directory.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  title: {
    ...Typography.heading1,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.bodySmall,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  libName: {
    ...Typography.body,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  libVersion: {
    color: Colors.textMuted,
    fontWeight: '400',
    fontSize: 14,
  },
  libLicense: {
    ...Typography.bodySmall,
    color: Colors.accent,
    marginTop: 2,
  },
  libCopyright: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: Spacing.sm,
  },
  footer: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    marginTop: Spacing.xl,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
