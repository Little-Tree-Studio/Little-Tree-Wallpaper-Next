import {
  Avatar,
  Box,
  Card,
  CardContent,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import type React from 'react';

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 0.5 }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}

export function StatCard({ icon, title, value, description }: { icon: React.ReactNode; title: string; value: string; description: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Avatar sx={{ bgcolor: 'primary.50', color: 'primary.main' }}>{icon}</Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {title}
              </Typography>
              <Typography variant="h5">{value}</Typography>
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, description, action, compact = false }: { title: string; description: string; action?: React.ReactNode; compact?: boolean }) {
  return (
    <Card>
      <CardContent sx={{ py: compact ? 4 : 6 }}>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant={compact ? 'h6' : 'h5'}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
          {action}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function SettingsSwitchRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void | Promise<void> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <Switch checked={checked} onChange={(event) => void onChange(event.target.checked)} />
      </Stack>
    </Paper>
  );
}
