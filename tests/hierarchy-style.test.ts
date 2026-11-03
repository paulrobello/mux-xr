// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mountWorkspaceUI, validateSettings, type WorkspaceSettings } from '../src/ui';
import { DEFAULT_HIERARCHY_STYLE, validateHierarchyStyle } from '../src/workspace/hierarchy-style';

describe('hierarchy style settings', () => {
  it('validates known styles and safely defaults missing or invalid values', () => {
    expect(validateHierarchyStyle('helix')).toBe('helix');
    expect(validateHierarchyStyle('spatial-docks')).toBe('spatial-docks');
    expect(validateHierarchyStyle('invalid')).toBe(DEFAULT_HIERARCHY_STYLE);
    expect(validateSettings({ hierarchyStyle: 'invalid' }).hierarchyStyle).toBe(
      DEFAULT_HIERARCHY_STYLE,
    );
  });

  it('persists browser selection and synchronizes scene updates without recursion', () => {
    localStorage.clear();
    const root = document.createElement('div');
    let ui: ReturnType<typeof mountWorkspaceUI>;
    const onSettingsChange = vi.fn((settings: WorkspaceSettings) => {
      ui.setHierarchyStyle(settings.hierarchyStyle, true);
    });
    ui = mountWorkspaceUI(root, { onConnect: () => undefined, onSettingsChange });
    const select = root.querySelector<HTMLSelectElement>('[data-hierarchy-style]');
    if (!select) throw new Error('Hierarchy style control missing');
    select.value = 'spatial-docks';
    select.dispatchEvent(new Event('change'));
    expect(onSettingsChange).toHaveBeenCalledOnce();
    expect(ui.getSettings().hierarchyStyle).toBe('spatial-docks');
    expect(JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}').hierarchyStyle).toBe(
      'spatial-docks',
    );
    ui.setHierarchyStyle('helix', true);
    expect(select.value).toBe('helix');
    expect(onSettingsChange).toHaveBeenCalledTimes(2);
    ui.destroy();
    localStorage.clear();
  });
});
