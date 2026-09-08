#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AuralithBridgeBlueprintLibrary.generated.h"

UCLASS()
class AURALITHBRIDGE_API UAuralithBridgeBlueprintLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category = "Auralith Bridge")
    static UObject* GetDefaultObjectByClassPath(const FString& ClassPath, FString& Error);

    UFUNCTION(BlueprintCallable, Category = "Auralith Bridge")
    static bool GetObjectPropertyAsString(UObject* Target, FName PropertyName, FString& Value, FString& Error);

    UFUNCTION(BlueprintCallable, Category = "Auralith Bridge")
    static bool SetObjectPropertyFromString(UObject* Target, FName PropertyName, const FString& Value, bool bSaveConfig, FString& Error);

    UFUNCTION(BlueprintCallable, Category = "Auralith Bridge")
    static bool CallFunctionNoArgs(UObject* Target, FName FunctionName, FString& Error);
};
