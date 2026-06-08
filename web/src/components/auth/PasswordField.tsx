import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIELD_CLASS, FIELD_INPUT_CLASS } from './auth-shared';

export function PasswordField({
  label,
  name,
  placeholder,
  autoComplete,
}: {
  label: string;
  name: string;
  placeholder: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className={FIELD_CLASS}>
      <span>{label}</span>
      <span className="relative block">
        <Input
          className={`${FIELD_INPUT_CLASS} pr-12`}
          name={name}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        <Button
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-[0.35rem] -translate-y-1/2"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => setVisible((isVisible) => !isVisible)}
        >
          {visible ?
            <EyeOff />
          : <Eye />}
        </Button>
      </span>
    </label>
  );
}
