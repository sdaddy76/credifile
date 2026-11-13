import * as React from "react"
import {
  type FieldPath,
  type FieldValues,
  useFormContext,
} from "react-hook-form"

export type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> = {
  name: TName
}

export const FormFieldContext =
  React.createContext<FormFieldContextValue | null>(null)

export const FormItemContext = React.createContext<{ id: string }>({ id: "" })

export const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const { id } = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const fieldState = getFieldState(fieldContext.name, formState)

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}
