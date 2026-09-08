#include "AuralithBridgeBlueprintLibrary.h"

#include "UObject/UnrealType.h"
#include "UObject/UObjectGlobals.h"

UObject* UAuralithBridgeBlueprintLibrary::GetDefaultObjectByClassPath(const FString& ClassPath, FString& Error)
{
    Error.Reset();
    UClass* LoadedClass = LoadObject<UClass>(nullptr, *ClassPath);
    if (!LoadedClass)
    {
        Error = FString::Printf(TEXT("Could not load class: %s"), *ClassPath);
        return nullptr;
    }

    UObject* DefaultObject = LoadedClass->GetDefaultObject();
    if (!DefaultObject)
    {
        Error = FString::Printf(TEXT("Class has no default object: %s"), *ClassPath);
        return nullptr;
    }
    return DefaultObject;
}

bool UAuralithBridgeBlueprintLibrary::GetObjectPropertyAsString(
    UObject* Target,
    FName PropertyName,
    FString& Value,
    FString& Error)
{
    Value.Reset();
    Error.Reset();
    if (!Target)
    {
        Error = TEXT("Target is null.");
        return false;
    }

    FProperty* Property = FindFProperty<FProperty>(Target->GetClass(), PropertyName);
    if (!Property)
    {
        Error = FString::Printf(TEXT("Property not found: %s"), *PropertyName.ToString());
        return false;
    }

    const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Target);
    Property->ExportTextItem_Direct(Value, ValuePtr, nullptr, Target, PPF_None);
    return true;
}

bool UAuralithBridgeBlueprintLibrary::SetObjectPropertyFromString(
    UObject* Target,
    FName PropertyName,
    const FString& Value,
    bool bSaveConfig,
    FString& Error)
{
    Error.Reset();
    if (!Target)
    {
        Error = TEXT("Target is null.");
        return false;
    }

    FProperty* Property = FindFProperty<FProperty>(Target->GetClass(), PropertyName);
    if (!Property)
    {
        Error = FString::Printf(TEXT("Property not found: %s"), *PropertyName.ToString());
        return false;
    }

    Target->Modify();
    Target->PreEditChange(Property);

    void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Target);
    const TCHAR* ImportResult = Property->ImportText_Direct(*Value, ValuePtr, Target, PPF_None);
    if (!ImportResult)
    {
        Error = FString::Printf(TEXT("Could not import value '%s' into property '%s'."), *Value, *PropertyName.ToString());
        return false;
    }

    FPropertyChangedEvent ChangedEvent(Property, EPropertyChangeType::ValueSet);
    Target->PostEditChangeProperty(ChangedEvent);

    if (bSaveConfig)
    {
        Target->SaveConfig();
    }
    return true;
}

bool UAuralithBridgeBlueprintLibrary::CallFunctionNoArgs(UObject* Target, FName FunctionName, FString& Error)
{
    Error.Reset();
    if (!Target)
    {
        Error = TEXT("Target is null.");
        return false;
    }

    UFunction* Function = Target->FindFunction(FunctionName);
    if (!Function)
    {
        Error = FString::Printf(TEXT("Function not found: %s"), *FunctionName.ToString());
        return false;
    }

    if (Function->NumParms != 0)
    {
        Error = FString::Printf(TEXT("Function '%s' requires parameters; this generic helper only calls zero-parameter functions."), *FunctionName.ToString());
        return false;
    }

    Target->ProcessEvent(Function, nullptr);
    return true;
}
