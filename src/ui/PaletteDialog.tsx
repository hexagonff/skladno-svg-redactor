import { useEffect, useRef, useState, type FormEvent } from 'react';
import { COLOR_ROLES, type ColorRole } from '../domain/colors';
import type { ColorScheme } from '../domain/library';
import {
  normalizeSchemeColor,
  SCHEME_NAME_MAX_LENGTH,
} from '../domain/schemes';
import './PaletteDialog.css';

interface PaletteDialogProps {
  baseScheme: ColorScheme;
  onAdd: (name: string, colors: Record<ColorRole, string>) => void;
  onClose: () => void;
}

const roleLabels: Record<ColorRole, string> = {
  bg1: 'Фон 1',
  bg2: 'Фон 2',
  bg3: 'Фон 3',
  black: 'Чёрный',
  obj1: 'Объект 1',
  obj2: 'Объект 2',
  obj3: 'Объект 3',
  white: 'Белый',
};
const groups: readonly { name: string; roles: readonly ColorRole[] }[] = [
  { name: 'Цвета фона', roles: ['bg1', 'bg2', 'bg3', 'black'] },
  { name: 'Цвета объектов', roles: ['obj1', 'obj2', 'obj3', 'white'] },
];

export function PaletteDialog({
  baseScheme,
  onAdd,
  onClose,
}: PaletteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('Своя палитра');
  const [colors, setColors] = useState<Record<ColorRole, string>>(() => ({
    ...baseScheme.colors,
  }));
  const [errors, setErrors] = useState<
    Partial<Record<ColorRole | 'name', string>>
  >({});
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    nameRef.current?.focus();
    nameRef.current?.select();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function changeColor(role: ColorRole, value: string) {
    setColors((current) => ({ ...current, [role]: value }));
    setErrors((current) => ({ ...current, [role]: undefined }));
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<ColorRole | 'name', string>> = {};
    if (!name.trim() || name.trim().length > SCHEME_NAME_MAX_LENGTH)
      nextErrors.name = `Введите название от 1 до ${SCHEME_NAME_MAX_LENGTH} символов.`;
    const normalized = {} as Record<ColorRole, string>;
    for (const role of COLOR_ROLES) {
      const color = normalizeSchemeColor(colors[role]);
      if (color) normalized[role] = color;
      else nextErrors[role] = 'Введите HEX из 3 или 6 цифр, например #AABBCC.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError('Проверьте название и цвета палитры.');
      const invalidField = nextErrors.name
        ? nameRef.current
        : dialogRef.current?.querySelector<HTMLInputElement>(
            `[data-color-role="${COLOR_ROLES.find((role) => nextErrors[role])}"]`,
          );
      invalidField?.focus();
      return;
    }
    try {
      onAdd(name.trim(), normalized);
      close();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Не удалось добавить палитру.',
      );
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="palette-dialog"
      aria-labelledby="palette-dialog-title"
      aria-describedby="palette-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          close();
      }}
    >
      <form className="palette-dialog__form" noValidate onSubmit={submit}>
        <header className="palette-dialog__header">
          <h2 id="palette-dialog-title">Новая палитра</h2>
          <button
            className="palette-dialog__close"
            type="button"
            aria-label="Закрыть"
            onClick={close}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>
        <div className="palette-dialog__body">
          <div className="palette-dialog__name">
            <label htmlFor="palette-name">Название палитры</label>
            <input
              ref={nameRef}
              type="text"
              id="palette-name"
              value={name}
              maxLength={SCHEME_NAME_MAX_LENGTH}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'palette-name-error' : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
                setError('');
              }}
            />
            {errors.name && (
              <span
                className="palette-dialog__field-error"
                id="palette-name-error"
              >
                {errors.name}
              </span>
            )}
          </div>
          <p className="field-hint" id="palette-dialog-description">
            Введите HEX или выберите цвет. Палитра перекрасит всю композицию и
            исчезнет после перезагрузки страницы.
          </p>
          <div className="palette-dialog__groups">
            {groups.map((group) => (
              <fieldset key={group.name} className="palette-dialog__group">
                <legend>{group.name}</legend>
                {group.roles.map((role) => {
                  const label = roleLabels[role];
                  return (
                    <div className="palette-dialog__color" key={role}>
                      <label htmlFor={`palette-${role}`}>{label}</label>
                      <div className="palette-dialog__color-inputs">
                        <input
                          className="palette-dialog__picker"
                          type="color"
                          aria-label={`Выбрать цвет: ${label}`}
                          value={
                            normalizeSchemeColor(colors[role]) ??
                            baseScheme.colors[role]
                          }
                          onChange={(event) =>
                            changeColor(role, event.target.value.toUpperCase())
                          }
                        />
                        <input
                          className="palette-dialog__hex"
                          id={`palette-${role}`}
                          data-color-role={role}
                          type="text"
                          value={colors[role]}
                          placeholder="#AABBCC"
                          spellCheck={false}
                          autoComplete="off"
                          aria-invalid={Boolean(errors[role])}
                          aria-describedby={
                            errors[role] ? `palette-${role}-error` : undefined
                          }
                          onChange={(event) =>
                            changeColor(role, event.target.value)
                          }
                        />
                      </div>
                      {errors[role] && (
                        <p
                          className="palette-dialog__field-error"
                          id={`palette-${role}-error`}
                        >
                          {errors[role]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
          {error && (
            <p className="palette-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="palette-dialog__footer">
          <button
            className="button palette-dialog__cancel"
            type="button"
            onClick={close}
          >
            Отмена
          </button>
          <button className="button button--primary" type="submit">
            Добавить и применить
          </button>
        </footer>
      </form>
    </dialog>
  );
}
