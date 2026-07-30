import { useEffect, useRef, useState, type Key } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Clipboard, Copy, Redo2, Scissors, TextSelect, Undo2 } from 'lucide-react';
import { Kbd, Label, ListBox, Separator } from '@heroui/react';
import { getClipboardText } from '@/api/backend';

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

type MenuState = {
  x: number;
  y: number;
  target: EditableElement;
  hasSelection: boolean;
  hasContent: boolean;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  clipboardText: string;
};

const TEXT_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
]);

function getEditableElement(target: EventTarget | null): EditableElement | null {
  if (!(target instanceof Element)) return null;

  const element = target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) ? element : null;
  }
  return element instanceof HTMLElement ? element : null;
}

function getSelectionState(target: EditableElement) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return {
      hasSelection: (target.selectionEnd ?? 0) > (target.selectionStart ?? 0),
      hasContent: target.value.length > 0,
      readOnly: target.readOnly || target.disabled,
    };
  }

  const selection = window.getSelection();
  return {
    hasSelection: Boolean(
      selection
      && !selection.isCollapsed
      && selection.anchorNode
      && selection.focusNode
      && target.contains(selection.anchorNode)
      && target.contains(selection.focusNode),
    ),
    hasContent: (target.textContent?.length ?? 0) > 0,
    readOnly: target.contentEditable === 'false',
  };
}

export default function TextContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setMenu(null);
  }, [location.key, location.pathname, location.search, location.hash]);

  useEffect(() => {
    const openMenu = (event: MouseEvent) => {
      const target = getEditableElement(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      target.focus();
      const { hasSelection, hasContent, readOnly } = getSelectionState(target);
      setMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 272)),
        target,
        hasSelection,
        hasContent,
        readOnly,
        canUndo: !readOnly && document.queryCommandEnabled('undo'),
        canRedo: !readOnly && document.queryCommandEnabled('redo'),
        clipboardText: '',
      });
      void getClipboardText().then((clipboardText) => {
        setMenu((current) => current?.target === target ? { ...current, clipboardText } : current);
      });
    };

    const closeMenu = () => setMenu(null);
    const closeMenuFromPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('contextmenu', openMenu, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('hashchange', closeMenu);
    window.addEventListener('popstate', closeMenu);
    document.addEventListener('pointerdown', closeMenuFromPointer, true);

    return () => {
      document.removeEventListener('contextmenu', openMenu, true);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('hashchange', closeMenu);
      window.removeEventListener('popstate', closeMenu);
      document.removeEventListener('pointerdown', closeMenuFromPointer, true);
    };
  }, []);

  const runAction = async (key: Key) => {
    if (!menu) return;

    const { target } = menu;
    target.focus();

    if (key === 'select-all') {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } else if (key === 'paste') {
      document.execCommand('insertText', false, menu.clipboardText);
    } else {
      document.execCommand(String(key));
    }

    setMenu(null);
  };

  if (!menu) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu-enter fixed w-[208px] rounded-xl border border-border bg-background/98 p-1.5 shadow-xl backdrop-blur"
      style={{ left: menu.x, top: menu.y, zIndex: 2147483647 }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ListBox
        aria-label="文本编辑操作"
        selectionMode="none"
        disabledKeys={[
          ...(!menu.hasSelection ? ['cut', 'copy'] : []),
          ...(!menu.hasContent ? ['select-all'] : []),
          ...(!menu.canUndo ? ['undo'] : []),
          ...(!menu.canRedo ? ['redo'] : []),
          ...(menu.readOnly || !menu.clipboardText ? ['paste'] : []),
          ...(menu.readOnly ? ['cut', 'undo', 'redo'] : []),
        ]}
        onAction={(key) => void runAction(key)}
      >
        <ListBox.Item id="undo" textValue="撤销"><Undo2 size={15} className="text-muted" /><Label>撤销</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl Z</Kbd.Content></Kbd></ListBox.Item>
        <ListBox.Item id="redo" textValue="重做"><Redo2 size={15} className="text-muted" /><Label>重做</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl Y</Kbd.Content></Kbd></ListBox.Item>
        <Separator />
        <ListBox.Item id="cut" textValue="剪切"><Scissors size={15} className="text-muted" /><Label>剪切</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl X</Kbd.Content></Kbd></ListBox.Item>
        <ListBox.Item id="copy" textValue="复制"><Copy size={15} className="text-muted" /><Label>复制</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl C</Kbd.Content></Kbd></ListBox.Item>
        <ListBox.Item id="paste" textValue="粘贴"><Clipboard size={15} className="text-muted" /><Label>粘贴</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl V</Kbd.Content></Kbd></ListBox.Item>
        <Separator />
        <ListBox.Item id="select-all" textValue="全选"><TextSelect size={15} className="text-muted" /><Label>全选</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl A</Kbd.Content></Kbd></ListBox.Item>
      </ListBox>
    </div>,
    document.body,
  );
}
