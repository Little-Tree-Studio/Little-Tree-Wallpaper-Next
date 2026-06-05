/**
 * 应用版本信息
 *
 * 通过修改此处的常量来控制版本状态和版本号。
 * 当 `VERSION_STATUS` 不为 `'release'` 时，应用右下角会显示水印。
 */

export type VersionStatus = 'release' | 'beta' | 'alpha' | 'dev';

/** 当前版本状态 */
export const VERSION_STATUS: VersionStatus = 'beta' as VersionStatus;

/** 当前版本号 */
export const VERSION_NUMBER = '2.0.0';

/** 是否为发布版本（release 状态时不显示水印） */
export const IS_RELEASE: boolean = VERSION_STATUS === 'release';

/** 版本状态对应的显示文本 */
const STATUS_LABELS: Record<VersionStatus, string> = {
  release: '',
  beta: '测试版',
  alpha: '内测版',
  dev: '开发版',
};

/** 获取完整的版本显示文本 */
export function getVersionLabel(): string {
  const statusLabel = STATUS_LABELS[VERSION_STATUS];
  return statusLabel ? `${statusLabel} v${VERSION_NUMBER}` : `v${VERSION_NUMBER}`;
}
